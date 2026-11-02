import { CHALLENGES, PERSONS, personOf } from '../data/case';
import { toneOf } from '../data/tone';
import type { PersonId } from '../data/types';
import { plain } from '../data/clues';
import { evidenceById, factById, nameOf, statementById, textOf, titleOf } from '../engine/lookup';
import { claimId, sourceId, visibleClaims } from '../engine/claims';
import { allowedFacts, type Interpretation, type Segment } from '../engine/logic';
import type { ChatMsg } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { callAI } from './transport';
import { bibleSheet, buildVoicePrompt, checkVoiced, type VoiceInput } from './voice';

/** 입력 길이 상한. 긴 입력은 지시문을 숨기기 쉽고 해석도 흐려진다 */
export const MAX_INPUT = 200;

/**
 * AI를 조작하려는 입력은 AI에 보내기 전에 걸러낸다.
 * 게임 안의 형사가 할 리 없는 말: 내부 ID, 출력 형식 이름, 시스템·규칙을 바꾸라는 요구.
 */
export function looksLikeInjection(text: string): boolean {
  // 자료·조사 ID("GT-R11 실행")도 플레이어 화면에는 나오지 않는 말이다 (2026-10-17 자동 점검: 수사팀이 ID 하나로 휴대폰 분석을 맡았다)
  return /\b(?:[A-E]-(?:F|G|S|Q|R|P)?\d{1,2}[a-z]?|X-L?\d{2}|GT-[A-Z]{1,3}\d{1,3}|TU-[A-Z]{1,2}\d{0,2})\b/.test(text)
    || /(citedEvidenceIds|targetClaimIds|factIds|segments|confidence|json)/i.test(text)
    || /(시스템|system|프롬프트|prompt|개발자|developer|어시스턴트|assistant)\s*(지시|메시지|message)?\s*[:：\]]/i.test(text)
    || /(지시|규칙|명령|프롬프트|설정|instruction|rule)[^.?!]{0,15}(무시|따르지|바꿔|변경|override|ignore)/i.test(text)
    || /(무시|ignore)[^.?!]{0,10}(지시|규칙|명령|프롬프트|instruction|rule)/i.test(text)
    || /(너는|당신은|you are)\s*(이제|지금부터|now)/i.test(text);
}

/** 기록되지 않는 답이라도 지적의 근거나 부분 반박에 쓰이면 근거 후보로 보여 준다 (예: 권태석이 전한 비서의 다툼) */
export const CITED_FACTS = new Set(CHALLENGES.flatMap((c) => [...c.requires.flat(), ...(c.partial ?? []).flatMap((p) => p.has)]).filter((id) => factById.has(id)));

export interface InterpretInput {
  person: PersonId;
  text: string;
  owned: Set<string>;
  history: ChatMsg[];
  /** 용의자별 상황 메모 (진행도, 이미 한 말, 직접 한 말, 최근 화제, 보여 준 근거) */
  memo?: string;
}

/** 답 전문 (AI가 물은 것에 답하는지 판단하고, 그 답을 인물의 말로 짓는 데 쓴다) */
const full = (t: string) => plain(t).replace(/\s+/g, ' ').trim();

/** 다른 사람의 진술은 앞부분만 보낸다 (내용 하나하나는 기록되는 답변으로 따로 들어간다) */
const brief = (id: string) => { const t = textOf(id).replace(/\s+/g, ' '); return statementById.has(id) && t.length > 120 ? `${t.slice(0, 120)}…` : t; };

/**
 * 해석 프롬프트. 해석과 함께 고른 답의 대사도 짓게 한다 (말투 요청을 따로 보내지 않는다). 캐시 칸 셋으로 나눈다 (CACHE_BREAK):
 *  1. 심문 대상·설정집·지금 태도·답할 수 있는 주제(답 전문) — 인물과 수사 단계가 같으면 그대로다
 *  2. 인물이 한 말·보유 자료 — 새 진술·자료가 생길 때만 바뀐다
 *  3. 상황 메모·최근 대화·형사의 말 — 매번 바뀐다
 */
export function buildUserPrompt({ person, text, owned, history, memo }: InterpretInput): string {
  const p = PERSONS[person];
  // 심문 대상 자신의 진술·답변은 [인물이 한 말]에 문장 단위로 이미 있으므로 보유 자료에서는 뺀다
  const own = [...owned].filter((id) => (evidenceById.has(id) || statementById.has(id) || factById.get(id)?.record || CITED_FACTS.has(id)) && personOf(id) !== person);
  const claims = visibleClaims(person, owned);
  const facts = allowedFacts(person, owned);
  const recent = history.slice(-6).map((m) => `${m.role === 'me' ? '형사' : m.role === 'them' ? p.name : '기록'}: ${plain(m.text)}${m.attached?.length ? ` [첨부: ${m.attached.map(nameOf).join(', ')}]` : ''}`);
  const tone = toneOf(person, owned);
  return [
    `[심문 대상] ${person} ${p.name} (${p.role})`,
    '',
    '[인물 설정과 지금 입장] (대사를 지을 때의 말투와 맥락. 여기 없는 사실은 만들지 않는다)',
    bibleSheet(person, owned),
    '',
    `[지금 태도] ${tone.demeanor} — ${tone.voice}`,
    '',
    '[답할 수 있는 주제] (question의 factIds 후보)',
    ...facts.map((f) => `${f.id}: ${f.topic} ⇒ 답: ${full(f.answer)}`),
    CACHE_BREAK,
    '[인물이 한 말] (challenge의 targetClaimIds 후보, 문장 단위. 형사가 인물 자신의 앞선 말을 근거로 들면 이 ID를 citedEvidenceIds에 넣는다)',
    ...(claims.length ? claims.map((c) => `${c.id}: "${c.text}"${c.struck ? ' (이미 정정됨)' : ''}`) : ['(아직 받은 진술 없음)']),
    '',
    '[플레이어 보유 자료·진술] (citedEvidenceIds 후보)',
    ...own.map((id) => `${titleOf(id)}: ${brief(id)}`),
    CACHE_BREAK,
    '[상황 메모] (참고용: 지금까지 정해진 것. "그때", "거기", "그 사람" 같은 말이 무엇을 가리키는지 해석하는 데 쓴다)',
    memo ?? '(없음)',
    '',
    '[최근 대화] (참고용)',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_INPUT)),
    '</형사의 말>',
  ].join('\n');
}

/**
 * 맞대기: 형사가 상대의 말 하나(pin)에 근거를 붙여 내밀면, 그 말과 그 근거로만 판정한다.
 * 말로만 한 지적은 판정하지 않는다 (근거를 아무거나 늘어놓아 진술을 깨는 일을 막는다). 같은 말의 질문은 그대로 답한다.
 */
export function withAttachments(it: Interpretation, draft: { evidence: string[]; pin?: string } | undefined, person: PersonId, owned: Set<string>): Interpretation {
  const live = new Set(visibleClaims(person, owned).filter((c) => !c.struck).map((c) => c.id));
  const pin = draft?.pin && live.has(claimId(draft.pin)) ? claimId(draft.pin) : undefined;
  // 근거만 내밀면, 짚은 말 없이 그 근거가 무너뜨리는 이야기를 찾아 판정한다
  const attached = [...new Set((draft?.evidence ?? []).filter((id) => owned.has(sourceId(id))))];
  if (!pin && attached.length) return { segments: [{ kind: 'challenge', targetClaimIds: [], citedEvidenceIds: attached, factIds: [], exact: true, rough: true }], confidence: 1 };
  if (!pin) {
    if (!it.segments.some((s) => s.kind === 'challenge')) return it;
    const rest = it.segments.filter((s) => s.kind !== 'challenge');
    return { ...it, unpinned: true, segments: rest.length ? rest : [{ kind: 'clarify', targetClaimIds: [], citedEvidenceIds: [], factIds: [] }] };
  }
  const evidence = [...new Set((draft?.evidence ?? []).filter((id) => claimId(id) !== pin && owned.has(sourceId(id))))];
  return { segments: [{ kind: 'challenge', targetClaimIds: [pin], citedEvidenceIds: evidence, factIds: [], exact: true }], confidence: 1 };
}

/**
 * AI가 주제 ID를 조금 틀리게 적으면("A-F12"를 "A-12"로) 가장 가까운 실제 ID로 고친다. 고칠 수 없으면 버린다.
 * 틀린 ID 때문에 자료를 넘기는 답이 빠지고, 인물이 자료를 주는 척만 하는 일을 막는다.
 */
export function fixFactId(id: string): string | null {
  if (factById.has(id)) return id;
  const m = id.trim().toUpperCase().match(/^([ABC])\s*-\s*([A-Z]?)(\d{1,2})([A-Z]?)$/);
  if (!m) return null;
  const [, p, kind, n, suffix] = m;
  const tail = suffix.toLowerCase();
  for (const k of kind ? [kind] : ['Q', 'P', 'F', 'G', 'D', 'M', 'R']) {
    for (const num of [String(Number(n)), n.padStart(2, '0')]) {
      const cand = `${p}-${k}${num}${tail}`;
      if (factById.has(cand)) return cand;
    }
  }
  return null;
}

export function sanitize(raw: unknown): Interpretation {
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const kinds = ['challenge', 'question', 'detail', 'restate', 'clarify', 'offtopic', 'casual'];
  const segments: Segment[] = (Array.isArray(o.segments) ? o.segments : []).slice(0, 8).map((x) => {
    const g = (x ?? {}) as Record<string, unknown>;
    return {
      kind: (kinds.includes(g.kind as string) ? g.kind : 'clarify') as Segment['kind'],
      targetClaimIds: arr(g.targetClaimIds),
      citedEvidenceIds: arr(g.citedEvidenceIds),
      factIds: [...new Set(arr(g.factIds).map(fixFactId).filter((id): id is string => !!id))],
      ...(g.direct === false ? { direct: false } : {}),
      ...(typeof g.quote === 'string' ? { quote: g.quote } : {}),
    };
  });
  const confidence = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.5;
  const reply = typeof o.reply === 'string' && o.reply.trim() ? { text: o.reply.trim(), facts: arr(o.replyFacts).map(fixFactId).filter((id): id is string => !!id) } : undefined;
  return { segments, confidence, ...(reply?.facts.length ? { reply } : {}) };
}

export { AI_MODEL, aiStats } from './transport';

/**
 * 고른 답이 물은 것에 정말 답하는지 확인한다: AI가 옮겨 적은 구절이 그 답에 실제로 있어야 한다.
 * 구절이 없거나 답에 없는 말이면, 주제만 비슷한 답으로 보고 인물이 직접 쓰게 한다.
 */
export function checkDirect(it: Interpretation): Interpretation {
  const norm = (t: string) => plain(t).replace(/[\s“”"'.,…?!]/g, '');
  return {
    ...it,
    segments: it.segments.map((s) => {
      if (s.kind !== 'question' || !s.factIds.length) return s;
      const q = norm(s.quote ?? '');
      const found = q.length >= 4 && s.factIds.some((id) => {
        const f = factById.get(id);
        return !!f && [f.answer, ...(f.alt ?? [])].some((a) => norm(a).includes(q));
      });
      return found ? s : { ...s, direct: false };
    }),
  };
}

/** 해석 결과 형식 확인: segments 배열이 있어야 한다 (깨진 답은 다른 경로로 다시 받는다) */
function parseInterpretation(text: string): unknown {
  const o = JSON.parse(text) as { segments?: unknown };
  if (!Array.isArray(o.segments)) throw new Error('segments 없음');
  return o;
}

/** 해석을 받는다. 모든 경로가 실패하면 AiUnavailable을 던진다 (대화창이 실패한 질문으로 남기고 다시 보낼 수 있게 한다) */
export async function interpretWithAI(input: InterpretInput): Promise<Interpretation> {
  const text = await callAI('interpret', buildUserPrompt(input), { attemptMs: 15000, hedgeMs: 4500, budgetMs: 45000, parse: parseInterpretation });
  return checkDirect(sanitize(JSON.parse(text)));
}

// ─────────────── 사소한 질문에 대한 자유 답변 ───────────────
// 목록에 없고 사건과 무관한 질문에만 쓴다. AI는 사건의 진실을 모르고, 사건에 관한 말은 하지 않는다.
// 답은 기록되지 않고 근거로 쓸 수 없다. 걸러지면 인물의 "모른다" 대사로 대신한다.

/** 다른 사람·사건을 건드리는 답은 쓰지 않는다 */
const CASUAL_BANNED = ['회장', '살해', '죽', '범인', '흉기', '트로피', '피', '혈흔', '지문', '문자', '예약', '휴대폰', '카드', '출입', '집무실', '화장실', '매입점', '온정', '매각', '횡령', '운영비', '정산', '소명', '부검', '감정', '회의', '신고', '경찰', '수사', '증거', '알리바이', '그날', '그때', '아까'];

export function safeCasual(reply: string, person: PersonId): string | null {
  const t = reply.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 120 || t.includes('⟦')) return null;
  if (/\d{1,2}\s*시|\d{1,2}:\d{2}|\d+\s*분/.test(t)) return null;
  if (CASUAL_BANNED.some((w) => t.includes(w))) return null;
  const others = (Object.keys(ALIASES) as PersonId[]).filter((p) => p !== person).flatMap((p) => ALIASES[p]);
  if (others.some((a) => t.includes(a))) return null;
  return t;
}

/** 앞 문장부호까지의 짧은 말머리 ("아, 죄송해요!" 등) */
const opener = (t: string) => t.match(/^[^.!?…]{1,10}[.!?…]+\s*/)?.[0] ?? '';

/** 직전 잡담과 같은 말머리로 시작하면 떼어 낸다 (같은 말버릇이 매번 반복되면 기계 같다) */
export function dropRepeatedOpener(reply: string, previous: string[]): string {
  const o = opener(reply);
  if (!o || !previous.some((x) => opener(x).trim() === o.trim())) return reply;
  return reply.slice(o.length).trim() || reply;
}

/** 사소한 질문에 인물로서 답한다. 실패하거나 걸러지면 null */
export async function casualReply(person: PersonId, text: string, history: ChatMsg[]): Promise<string | null> {
  const p = PERSONS[person];
  const pairs: string[] = [];
  const earlier: string[] = [];
  history.forEach((m, i) => {
    if (m.role === 'them' && m.kind === 'casual' && history[i - 1]?.role === 'me') {
      pairs.push(`형사: ${history[i - 1].text}\n${p.name}: ${m.text}`);
      earlier.push(m.text);
    }
  });
  const user = [
    `[인물] ${p.name} (${p.age}세, ${p.role})`,
    `[말투] ${p.voice}`,
    `[태도] ${p.demeanor}`,
    `[프로필] ${p.profile}`,
    '[이전 잡담]',
    ...(pairs.length ? pairs.slice(-6) : ['(없음)']),
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_INPUT)),
    '</형사의 말>',
  ].join('\n');
  try {
    const o = JSON.parse(await callAI('casual', user, { attemptMs: 20000, hedgeMs: 8000, budgetMs: 30000, parse: JSON.parse })) as { reply?: string; refuse?: boolean };
    if (o.refuse || typeof o.reply !== 'string') return null;
    const safe = safeCasual(o.reply, person);
    return safe && dropRepeatedOpener(safe, earlier.slice(-3));
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[잡담 답변 실패]', e);
    return null;
  }
}



/** 플레이어가 근거를 내용으로 말했는지 확인할 때 쓰는 키워드 */
const CITE_KEYWORDS: Record<string, string[]> = {
  'GT-E02': ['신고', '21:26', '9시 26분', '흉기는 발견되지'],
  'GT-E04': ['부검', '사인', '한 차례', '즉사', '즉시 사망'],
  'GT-E05': ['마지막 문자', '9시 10분 문자', '21:10 문자', '반환 요구', '가져다 놓아라', '다시 가져와', '못 주겠'],
  'GT-E06': ['통화 기록', '통화 내역', '8시 25분 통화', '20:25', '무응답'],
  'GT-E07': ['출입 기록', '문 열림', '카드 기록', '문이 열린', '20:30', '20:45', '20:50'],
  'GT-E08': ['허락 문자', '허락', '심부름', '카드 대여', '가져가라'],
  'GT-E09': ['매입', '인수', '20:55', '8시 55분', '보관', '계약서', '620만'],
  'GT-E10': ['매입점 확인', '업무 경위', '매입점 안에', '자리를 비우지'],
  'GT-E11': ['흉기', '상처와 일치', '혈흔 반응', '대조 결과'],
  'GT-E12': ['회의 확인', '근무 확인', '회의 준비 공간', '중간 이탈'],
  'GT-E13': ['횡령', '소명', '6,400', '6400', '개인 계좌', '정산', '직접 설명'],
  'GT-E14': ['예약 발송', '예약 문자', '발송 방식', '예약된'],
  'GT-E15': ['등록 시각', '20:48', '8시 48분', '현장 입력', '예약 등록'],
  'GT-E16': ['표면 검사', '지문 검사', '선명한 지문', '맨손'],
  'GT-E17': ['민아 지문', '지문 대조', '서민아의 것', '지문만'],
  'GT-E18': ['보충 확인', '카드 대여', '45분에 나왔다고', '출입 진술'],
  'GT-E19': ['감식', '혈흔 반응', '루미놀', '닦인 혈흔', '끌린 흔적', '옮긴 흔적'],
};

const ALIASES: Record<PersonId, string[]> = {
  A: ['류준서', '준서', '아드님', '아들'],
  B: ['서민아', '민아', '행사 지원'],
  C: ['문태준', '태준', '총지배인', '지배인'],
};

/**
 * 말에서 이름을 댄 다른 사람 가운데, 그 사람에게서 아직 이 주제의 말을 듣지 못한 사람.
 * "권 대표가 그랬다던데요"처럼 듣지 않은 전언을 근거로 들었을 때 안내하는 데 쓴다.
 */
export function unheardWitness(text: string, person: PersonId, cited: string[]): PersonId | null {
  const named = (Object.keys(ALIASES) as PersonId[]).filter((p) => p !== person && ALIASES[p].some((a) => text.includes(a)));
  return named.find((p) => !cited.some((id) => personOf(id) === p)) ?? null;
}

/** 플레이어 말에 이 근거를 가리키는 표현이 있는가 */
export function mentions(id: string, text: string): boolean {
  const p = personOf(id);
  if (p) return ALIASES[p].some((a) => text.includes(a)) || (factById.get(id)?.keywords ?? []).some((k) => text.includes(k));
  const ev = evidenceById.get(id);
  if (!ev) return false;
  const words = [...(CITE_KEYWORDS[id] ?? []), ...ev.title.split(/[\s·]+/).filter((w) => w.length >= 2)];
  return words.some((w) => text.includes(w));
}

/**
 * 근거 확인: AI가 붙인 근거 중 플레이어가 실제로 말하지 않은 것은 뺀다.
 * 바꿔 말한 표현을 놓칠 수 있으므로, 근거가 1~2개뿐이고 하나도 확인되지 않으면 AI의 판단을 믿는다.
 */
export function ground(it: Interpretation, text: string, person: PersonId): Interpretation {
  // 명시한 문서 이름은 AI가 빠뜨려도 보존한다. 내용·시각만으로 새 근거를 추측하지 않는다.
  const compact = text.replace(/\s+/g, '');
  const aliases: Record<string, string[]> = {
    'GT-E05': ['준서가 받은 문자', '아들이 받은 문자'],
    'GT-E07': ['출입 원본', '카드 원본'],
    'GT-E15': ['휴대폰 분석', '예약 등록 내역'],
    'GT-E17': ['지문 감정', '인물 대조'],
  };
  const explicit = [...evidenceById.values()]
    .filter((ev) => [ev.title, ...(aliases[ev.id] ?? []), ...(MARKERS[ev.id] ?? [])].some((name) => compact.includes(name.replace(/\s+/g, ''))))
    .map((ev) => ev.id);
  return {
    ...it,
    segments: it.segments.map((s) => {
      const outside = s.citedEvidenceIds.filter((id) => personOf(id) !== person);
      const kept = outside.filter((id) => mentions(id, text));
      const trust = !kept.length && outside.length <= 2;
      const cited = s.citedEvidenceIds.filter((id) => personOf(id) === person || trust || kept.includes(id));
      return { ...s, citedEvidenceIds: [...new Set([...cited, ...(s.kind === 'challenge' ? explicit : [])])] };
    }),
  };
}

/**
 * 한 자료에만 나오는 표시(정확한 시각·수치). 형사가 이것을 말했으면 그 자료를 근거로 든 것이다.
 * AI가 비교 대상 하나를 빠뜨려도 보존한다. 여러 자료에 걸친 시각은 넣지 않는다.
 */
const MARKERS: Record<string, string[]> = {
  'GT-E15': ['20:48', '8시 48분', '20시 48분'],
  'GT-E09': ['20:55', '8시 55분', '20시 55분'],
  'GT-E13': ['6,400만', '6400만', '12:40'],
};

/** 자료를 보여 달라·넘겨 달라는 요청 */
const HANDOVER = /(보여\s?주|보여\s?줄|보여\s?달|넘겨\s?주|제출|받을 수|받아 갈|볼 수 있|확인할 수 있|가져와|주실 수)/;

/**
 * "그 사본 보여 주세요"처럼 자료를 달라는 말에, 이 인물이 지금 넘길 수 있는 자료가 있으면 그 답을 고른다.
 * AI가 다른 주제나 없는 ID를 골라도 자료 요청의 뜻이 사라지지 않게 한다. 넘길 수 없는 단계면 그대로 둔다.
 */
export function keepHandover(it: Interpretation, text: string, person: PersonId, owned: Set<string>): Interpretation {
  if (!HANDOVER.test(text) || it.segments.some((s) => s.kind === 'challenge')) return it;
  const giving = allowedFacts(person, owned).filter((f) => f.reveals?.some((id) => evidenceById.has(id) && !owned.has(id)));
  if (giving.some((f) => it.segments.some((s) => s.factIds.includes(f.id)))) return it;
  const hit = giving.find((f) => f.keywords.some((k) => k.length >= 2 && text.includes(k)));
  if (!hit) return it;
  return { ...it, segments: [{ kind: 'question', targetClaimIds: [], citedEvidenceIds: [], factIds: [hit.id], direct: true }, ...it.segments.filter((s) => s.kind !== 'clarify' && s.kind !== 'offtopic')] };
}

// ─────────────── 준비된 답이 없을 때 인물이 직접 쓰는 답 ───────────────
// 사건에 관한 질문인데 미리 쓴 답 중 맞는 것이 없으면, 인물의 지금 단계 "상황 설정"을 읽고 AI가 그 인물로서 쓴다.
// 상황 설정 = 그 인물이 이 단계에서 할 수 있는 모든 준비된 답(숨기는 단계면 거짓말 그대로) + 공개된 사건 개요.
// 그래서 아직 드러나지 않은 진실은 AI가 보지 못한다. 시각·숫자는 상황 설정에 있는 것만 쓸 수 있다.
// 쓴 답은 진술로 기록되지 않고 근거가 되지 않는다.

/** 쓴 답을 검사한다: 상황 설정에 없는 시각·숫자, 근거 표기, 너무 긴 답은 쓰지 않는다 */
export function safeWritten(reply: string, sheet: string): string | null {
  const t = reply.trim().replace(/\s+/g, ' ');
  if (!t || t.length > 200 || t.includes('⟦')) return null;
  const nums = t.match(/\d+(?:[:시분]\s?\d*)?/g) ?? [];
  if (nums.some((n) => !sheet.includes(n.replace(/\s/g, '')) && !sheet.includes(n))) return null;
  if (/(범인|자백|살해했|죽였습니다|죽였어요)/.test(t)) return null;
  // 실제로 넘기지 않은 자료를 건네는 척하는 말은 쓰지 않는다
  if (/(사본|자료|서류|파일|기록|노트북|문서).{0,20}(보세요|보시면|보여 드|드릴게|드리겠|드리죠|가져가|넘겨 드|확인해 보세요|확인하세요)/.test(t)) return null;
  return t;
}

/** 이 인물의 지금 단계 상황 설정 (준비된 답 전체를 평문으로) */
export function situationSheet(person: PersonId, owned: Set<string>): string {
  return allowedFacts(person, owned).map((f) => `- (${f.topic}) ${plain(f.answer)}`).join('\n');
}

/** 직접 쓴 답. failed는 AI에 닿지 못한 경우다 (인물이 모른다고 한 것과 구별한다) */
export interface Written { reply: string | null; failed?: boolean }

export async function writeAnswer(person: PersonId, text: string, owned: Set<string>, history: ChatMsg[], memo = ''): Promise<Written> {
  const p = PERSONS[person];
  const sheet = situationSheet(person, owned);
  const examples = allowedFacts(person, owned).filter((f) => f.id.includes('-D') || f.id.includes('-F')).slice(0, 8).map((f) => `- ${plain(f.answer)}`);
  const recent = history.slice(-6).map((m) => `${m.role === 'me' ? '형사' : m.role === 'them' ? p.name : '기록'}: ${plain(m.text)}`);
  // 말투는 지금까지 인정한 범위에 맞춘다 (숨기는 단계와 인정한 뒤의 태도가 다르다)
  const tone = toneOf(person, owned);
  const user = [
    `[인물] ${p.name} (${p.age}세, ${p.role})`,
    `[말투] ${tone.voice}`,
    `[태도] ${tone.demeanor}`,
    `[프로필] ${p.profile}`,
    '',
    '[인물 설정과 지금 입장] (말투와 맥락을 위한 것. 여기 없는 사실은 만들지 않는다)',
    bibleSheet(person, owned),
    '',
    '[상황 설정] (이 인물이 지금 할 수 있는 말 전부)',
    sheet,
    '',
    '[준비된 답의 말투 예시]',
    ...examples,
    // 여기까지는 인물과 수사 단계가 같으면 그대로다 (캐시한다)
    CACHE_BREAK,
    '[상황 메모] (지금까지 정해진 것)',
    memo || '(없음)',
    '',
    '[최근 대화]',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_INPUT)),
    '</형사의 말>',
  ].join('\n');
  try {
    const o = JSON.parse(await callAI('write', user, { attemptMs: 12000, hedgeMs: 4000, budgetMs: 20000, parse: JSON.parse })) as { reply?: string; refuse?: boolean };
    if (o.refuse || typeof o.reply !== 'string') return { reply: null };
    return { reply: safeWritten(o.reply, `${sheet}\n${memo}`) };
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[직접 쓴 답 실패]', e);
    return { reply: null, failed: true };
  }
}


// ─────────────── 인물의 목소리 ───────────────
// 엔진이 정한 말(내용 요점)을 설정집과 대화 흐름에 맞춰 인물의 말로 짓는다. 검사를 통과하지 못하거나 늦으면 정해 둔 말을 쓴다.

export async function voiceAnswer(input: VoiceInput): Promise<string | null> {
  try {
    const o = JSON.parse(await callAI('voice', buildVoicePrompt(input), { attemptMs: 7000, hedgeMs: 7000, budgetMs: 8000, parse: JSON.parse })) as { reply?: string };
    if (typeof o.reply !== 'string') return null;
    const ok = checkVoiced(o.reply, input.points, input.person, input.owned, input.question);
    if (!ok && import.meta.env?.DEV) console.warn('[목소리 검사 탈락]', o.reply);
    return ok;
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[목소리 실패]', e);
    return null;
  }
}
