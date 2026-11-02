import { PERSONS, STATEMENTS } from '../data/case';
import { plain } from '../data/clues';
import { STATEMENT_FORMS } from '../data/statementForms';
import type { PersonId } from '../data/types';
import { visibleClaims, type Claim } from '../engine/claims';
import { phoneCallAsLastMeeting } from '../engine/consistency';
import { nameOf } from '../engine/lookup';
import type { AiStatement, ChatMsg, StatementLine } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { callAI } from './transport';

// 진술서 (2026-10-15). 대화를 AI에 맡긴 뒤로 진술서(정해 둔 답 ID로 채우는 양식)가 대화와 어긋났다:
// 인물이 다른 말로 같은 주장을 하면 진술서에 빠지고, 처음 주장을 들은 적도 없는데 "정정"이라고 나왔다.
// 이제 면담 대화를 통째로 AI에 주고, 진술인이 실제로 한 말만 진술서로 정리하게 한다.
// 거짓말이 무너졌는지 같은 판정은 지금처럼 엔진(대화 AI의 admit)이 하고, 진술서는 보여 주는 정리만 맡는다.

/** 대화에서 이만큼만 넘긴다 (오래된 것부터 자른다) */
const MAX_LINES = 160;
const MAX_LINE = 500;

// 2026-10-17: 대화마다 진술서 전체를 다시 쓰느라 출력 토큰이 진술서 비용의 2/3였다. 이제 바뀐 항목만 다시 쓰게 하고(delta),
// 인정·철회가 생기면(앞선 말에 기대던 문장을 여러 항목에서 거둬야 하므로) 전체를 다시 쓴다(full).

export interface StatementInput {
  person: PersonId;
  owned: Set<string>;
  chat: ChatMsg[];
  prev?: AiStatement;
  /** 정리 방식. 없으면 statementMode로 정한다 */
  mode?: StatementMode;
}

export type StatementMode = 'full' | 'delta';

/** 진술서 전체를 다시 써야 하는 상태의 표시: 이 인물이 인정한 것과 철회된 말 */
export function statementBasis(person: PersonId, owned: Set<string>): string {
  const admitted = STATEMENTS.filter((s) => s.person === person && !s.initial && owned.has(s.id)).map((s) => s.id);
  const struck = visibleClaims(person, owned).filter((c) => c.struck).map((c) => c.id);
  return [...admitted, ...struck].sort().join(',');
}

/** 이전 진술서가 있고 인정·철회가 그대로면 바뀐 항목만 다시 쓴다 */
export function statementMode({ person, owned, prev }: StatementInput): StatementMode {
  return prev?.sections.length && prev.basis === statementBasis(person, owned) ? 'delta' : 'full';
}

/** 진술서 정리에 쓸 대화 (응답 대기·실패한 말은 뺀다) */
export const settledTalk = (msgs: ChatMsg[]) => msgs.filter((m) => !m.status && !m.hint && !m.id.endsWith('-greet'));

const NEW_MARK = '── 여기부터 지난 정리 뒤의 새 대화 ──';
const FULL_RULE = '[정리 방식: 전체] 모든 항목을 처음부터 끝까지 적는다.';
const DELTA_RULE = `[정리 방식: 바뀐 항목만] "${NEW_MARK.replace(/─/g, '').trim()}" 표시 뒤의 대화 때문에 내용이 달라지는 항목만 sections에 넣는다. 넣는 항목은 바뀌지 않은 문장까지 그 항목 전체를 적는다(그 항목을 통째로 바꿔 끼운다). 새 말 때문에 다른 항목의 문장도 고치거나 거둬야 하면 그 항목도 넣는다. 바뀌지 않은 항목은 넣지 않는다. 바뀐 항목이 없으면 sections는 빈 배열이다.`;

function chatLine(m: ChatMsg, name: string): string {
  const t = plain(m.text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE);
  if (m.role === 'note') return `(기록: ${t}${m.sub ? ` — ${plain(m.sub)}` : ''})`;
  const att = m.attached?.length ? ` [형사가 내민 자료: ${m.attached.map(nameOf).join(', ')}]` : '';
  return `${m.role === 'me' ? '형사' : name}: ${t}${att}`;
}

/**
 * 캐시 칸: 1. 진술인·항목 제목 2. 근거 문장·인정·철회 (새 자료가 생길 때만 바뀐다) 3. 이전 진술서·정리 방식·대화 (매번 바뀐다. 캐시하지 않는다)
 */
export function buildStatementPrompt(input: StatementInput): string {
  const { person, owned, chat, prev } = input;
  const mode = input.mode ?? statementMode(input);
  const p = PERSONS[person];
  const f = STATEMENT_FORMS[person];
  const visible = visibleClaims(person, owned);
  // 정정으로 철회된 말: 본문에 남기지 않는다 (was로만)
  const struck = visible.filter((c) => c.struck);
  const admitted = STATEMENTS.filter((s) => s.person === person && !s.initial && owned.has(s.id));
  const talk = settledTalk(chat);
  const all = talk.map((m) => chatLine(m, p.name));
  // 바뀐 항목만 쓸 때는 지난 정리 뒤의 대화가 어디서 시작하는지 표시한다
  const from = mode === 'delta' && prev ? Math.min(prev.upto, all.length) : -1;
  if (from >= 0 && from < all.length) all.splice(from, 0, NEW_MARK);
  const lines = all.slice(-MAX_LINES);
  return [
    // 직업·관계는 진술서 머리 표(FormView)에 따로 나온다. 여기 적어 주면 진술인이 말하지 않은 신상("총지배인, 근속 9년")을 본문에 옮겼다 (2026-10-17)
    `[진술인] ${p.name} (직책·근속·관계 같은 신상은 머리 표에 따로 있다. 진술인이 대화에서 말하지 않았으면 본문에 적지 않는다)`,
    '',
    '[항목 제목 후보] (이 순서로. 진술이 없는 항목은 넣지 않는다. 문장은 말한 순서가 아니라 내용에 맞는 항목에 넣는다)',
    ...f.sections.map((s) => `- ${s.title}${s.about ? ` — 담는 것: ${s.about}` : ''}`),
    CACHE_BREAK,
    // 근거 문장 후보(미리 써 둔 진술서 문장)는 보여 주지 않는다. 대화보다 사실이 많아 그대로 옮겼다 (2026-10-17 사용자 플레이: 용의자가 한 말보다 훨씬 많은 정보가 적혔다).
    // cite는 엔진이 문장 유사도로 잇는다 (assignCites).
    '[게임 기록: 인정한 것] (진술인이 근거를 보고 인정해 게임에 기록된 것. kind를 정하는 데 쓴다. 본문에는 이 가운데 진술인이 [면담 대화]에서 실제로 말한 부분만 적는다)',
    ...(admitted.length ? admitted.map((s) => `- ${plain(s.say ?? s.text).replace(/^…\s*/, '')}`) : ['(없음)']),
    '',
    // 2026-10-17 Haiku: 무엇이 정정됐는지 짐작하게 두면 돈 문제를 added로 쓰거나 대화에 없는 말을 was로 지어냈다. 이 목록에서 고르게 한다
    '[철회된 말] (인정으로 거둔 말. 본문에 남기지 않고, 같은 뜻의 문장과 그 말을 전제로 한 문장도 거둔다. 진술인이 [면담 대화]에서 실제로 이 말을 했다면, 그것을 대신하는 지금의 말에 revised를 붙이고 was에 대화 속 그 말을 적는다. 대화에서 하지 않은 말은 was에 쓰지 않는다)',
    ...(struck.length ? struck.map((c) => `- ${plain(c.text)}`) : ['(없음)']),
    CACHE_BREAK,
    '[이전 진술서]',
    prev ? JSON.stringify({ sections: prev.sections }) : '(없음. 처음 정리한다)',
    '',
    mode === 'delta' ? DELTA_RULE : FULL_RULE,
    '',
    '[면담 대화] (오래된 것부터)',
    '이전 진술서를 그대로 복사하지 않는다. 철회된 말과 최신 인정에 모순되는 파생 진술은 현재 본문에서 거둔다. 전화 통화가 끝난 시각을 마지막 대면·대화 시각으로 바꾸지 않는다. 최종 자백과 모순되는 이전 문장은 현재 주장이나 인정 사실로 남기지 않는다.',
    ...(lines.length ? lines.map(noBreak) : ['(아직 대화 없음)']),
  ].join('\n');
}

const KINDS = new Set(['claim', 'fact', 'revised', 'added']);

/** AI의 정리에서 형식에 맞는 것만 남긴다. cite는 지금 볼 수 있는 말의 ID만 */
export function sanitizeStatement(raw: unknown, person: PersonId, owned: Set<string>, upto: number, now = Date.now()): AiStatement {
  const o = (raw ?? {}) as { sections?: unknown };
  const ok = new Set(visibleClaims(person, owned).filter((c) => !c.struck).map((c) => c.id));
  // 인정한 거짓말이 없는 사람은 숨기던 것을 털어놓을 일이 없다. "진술"(added) 표시는 일반 진술로 둔다
  // (2026-10-17 Haiku 비교: 정직한 증인의 평범한 답에 added를 붙여 진술서에 "진술" 표가 13~17줄 붙었다)
  const confessed = STATEMENTS.some((s) => s.person === person && !s.initial && owned.has(s.id));
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const sections = (Array.isArray(o.sections) ? o.sections : []).map((sec) => {
    const x = (sec ?? {}) as { title?: unknown; lines?: unknown };
    const lines = (Array.isArray(x.lines) ? x.lines : []).map((l): StatementLine | null => {
      const y = (l ?? {}) as Record<string, unknown>;
      const text = str(y.text);
      if (person === 'C' && phoneCallAsLastMeeting(text)) return null;
      // 내부 표기·ID가 섞인 문장은 쓰지 않는다
      if (!text || text.includes('⟦') || /\b[A-C]-(Q|R|F)\d+|\bGT-[ER]\d+/.test(text)) return null;
      let kind = KINDS.has(str(y.kind)) ? (str(y.kind) as StatementLine['kind']) : 'claim';
      const was = str(y.was);
      // 앞서 한 말이 없으면 정정이 아니다
      if (kind === 'revised' && !was) kind = 'added';
      if (kind === 'added' && !confessed) kind = 'claim';
      // 문장만 다듬은 같은 말은 정정이 아니다
      if (kind === 'revised' && was.replace(/[\s.,…"“”'‘’]/g, '') === text.replace(/[\s.,…"“”'‘’]/g, '')) kind = 'claim';
      const cite = (Array.isArray(y.cite) ? y.cite : []).filter((c): c is string => typeof c === 'string' && ok.has(c));
      return { text, kind, ...(kind === 'revised' ? { was } : {}), ...(cite.length ? { cite } : {}) };
    }).filter((l): l is StatementLine => !!l);
    return { title: str(x.title) || '진술', lines };
  }).filter((s) => s.lines.length);
  // 같은 문장이 두 번 나오거나, 정정 전의 말(was)이 본문에 그대로 남은 것은 뺀다 (2026-10-16 플레이 리뷰: 같은 45분 문장이 두 번 보였다)
  const norm = (t: string) => t.replace(/[\s.,…"“”'‘’]/g, '');
  const seen = new Set<string>();
  const olds = new Set(sections.flatMap((s) => s.lines.filter((l) => l.kind === 'revised' && l.was).map((l) => norm(l.was!))));
  const deduped = sections.map((s) => ({ ...s, lines: s.lines.filter((l) => {
    const k = norm(l.text);
    if (seen.has(k) || (l.kind !== 'revised' && olds.has(k))) return false;
    seen.add(k);
    return true;
  }) })).filter((s) => s.lines.length);
  return { sections: deduped, upto, at: now };
}

/** 인정한 단계의 새 말을 알아보는 낱말(re)과 옛 거짓말(lie). mixed: 옛 말에 바뀌지 않은 다른 사실이 함께 든 꼴(그 문장은 지우지 않는다) */
const STAGE_TOPIC: Record<string, { re: RegExp; lie: RegExp; mixed?: RegExp; said: RegExp; rewrite: (old: string) => string; stale?: RegExp }> = {
  'C-R01': { re: /(돈|운영비|계좌|정산|소명)/, lie: /정기\s*(운영\s*)?보고|보고를?\s*(드리러|하러|때문)/, said: /(돈|운영비|계좌|정산)/,
    rewrite: () => '돈 문제로 회장님께 불려 갔습니다.' },
  'C-R02': { re: /50분에\s*(집무실에서\s*)?(나왔|나온|퇴실)/, lie: /45분에\s*(제가\s*)?(집무실에서\s*)?나(왔|온|와)/, mixed: /들어/, said: /50\s*분/,
    rewrite: (old) => (/45\s*분/.test(old) ? old.replace(/(8\s*시\s*)?45\s*분/, '8시 50분') : '8시 50분에 나왔습니다.'),
    // 45분 퇴실을 전제로 한 말 (인정하면 함께 거둔다)
    stale: /나올\s*때\s*회장님은?\s*(책상에|멀쩡)|제가\s*나간\s*뒤\s*(누군가|다른\s*사람)/ },
  'C-R03': { re: /예약\s*발송|살아\s*계셨다는\s*근거/, lie: /$^/, said: /$^/, rewrite: (old) => old,
    stale: /(그때까지|9시\s*10분까지)\s*(회장님은?\s*)?살아\s*계셨/ },
};
/** 그 항목에 들어가면 안 되는 문장 → 옮길 항목 */
const MISPLACED: { person: PersonId; from: string; re: RegExp; to: string }[] = [
  // 낮 12시 40분 소명 요청 문자는 9시 10분 문자가 아니다 (Haiku 비교·자동 점검에서 거듭 "마지막 문자"에 넣었다)
  { person: 'C', from: '마지막 문자', re: /(12시\s*4\d분|소명|정산)/, to: '사건 당일 집무실 방문' },
];
const sentencesOf = (t: string) => plain(t).split(/(?<=[.?!…])\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * 진술서를 게임 기록에 맞춰 바로잡는다 (2026-10-17 자동 점검: Haiku가 돈 문제 인정을 revised 없이 fact·added로 적었다 3판 중 2판, 낮 문자를 마지막 문자 항목에 넣었다).
 * 인정한 단계의 새 말이 revised가 아니면, 옛 거짓말(본문에 남은 문장, 없으면 대화 속 그 사람의 말)을 was로 붙여 revised로 바꾸고 본문의 옛 거짓말은 지운다.
 */
export function reconcileStatement(st: AiStatement, person: PersonId, owned: Set<string>, chat: ChatMsg[]): AiStatement {
  let sections = st.sections.map((s) => ({ ...s, lines: [...s.lines] }));
  const claims = visibleClaims(person, owned).filter((c) => !c.struck);
  for (const m of MISPLACED.filter((x) => x.person === person)) {
    const from = sections.find((s) => s.title === m.from);
    const moving = from?.lines.filter((l) => m.re.test(l.text)) ?? [];
    if (!from || !moving.length) continue;
    from.lines = from.lines.filter((l) => !moving.includes(l));
    const to = sections.find((s) => s.title === m.to);
    if (to) to.lines.push(...moving);
    else {
      const order = STATEMENT_FORMS[person].sections.map((s) => s.title);
      sections.push({ title: m.to, lines: moving });
      sections.sort((a, b) => (order.indexOf(a.title) + 1 || 99) - (order.indexOf(b.title) + 1 || 99));
    }
  }
  const said = chat.filter((m) => m.role === 'them').flatMap((m) => sentencesOf(m.text));
  for (const [stage, topic] of Object.entries(STAGE_TOPIC)) {
    const lie = topic.lie;
    if (!owned.has(stage)) continue;
    // 인정으로 무너진 말을 전제로 한 문장은 거둔다 (2026-10-17: 50분 퇴실을 인정한 뒤에도 "나올 때 회장님은 멀쩡하셨다"가 남았다)
    if (topic.stale) sections = sections.map((s) => ({ ...s, lines: s.lines.filter((l) => l.kind === 'revised' || !topic.stale!.test(l.text)) }));
    const all = sections.flatMap((s) => s.lines);
    if (all.some((l) => l.kind === 'revised' && topic.re.test(l.text))) continue;
    // 방문 목적·이유를 말한 문장을 먼저 고른다 (낮 문자를 받은 일 같은 곁가지보다)
    const cands = all.filter((l) => topic.re.test(l.text) && !lie.test(l.text));
    const target = cands.find((l) => /(불려|목적|때문|다퉜)/.test(l.text)) ?? cands[0];
    if (!target) {
      // 새 말을 진술서에 옮기지 못하고 옛 거짓말만 남겼으면, 진술인이 대화에서 새 사실을 실제로 말했을 때 그 줄을 정정으로 바꾼다
      const old = all.find((l) => l.kind !== 'revised' && lie.test(l.text));
      if (old && said.some((x) => topic.said.test(x))) { old.was = old.text; old.text = topic.rewrite(old.text); old.kind = 'revised'; }
      continue;
    }
    // 옛 말이 본문에 따로 남아 있으면 그것을, 다른 사실이 함께 든 문장("30분에 들어가 45분에 나왔다")은 지우지 않고 대화 속 말에서 찾는다
    const pure = (t: string) => lie.test(t) && !topic.mixed?.test(t);
    const olds = all.filter((l) => l !== target && l.kind !== 'revised' && pure(l.text));
    const was = olds[0]?.text ?? said.find(pure) ?? said.find((x) => lie.test(x));
    if (!was) continue;
    target.kind = 'revised';
    target.was = was;
    sections = sections.map((s) => ({ ...s, lines: s.lines.filter((l) => !olds.includes(l)) }));
  }
  // 진술인이 말하지 않은 숫자·시각이 든 문장은 지운다 (2026-10-17 사용자 플레이: "근속 9년", "보증금 1,500만 원"처럼 대화에 없는 정보가 적혔다)
  const spoken = numbersIn(said.join(' '));
  // "50분에 나간 건 저입니다"처럼 분만 말해도 그 시각을 말한 것이다 (8:50 ← 50)
  const grounded = (l: StatementLine) => [...numbersIn(l.text)].every((n) => spoken.has(n) || (n.includes(':') && spoken.has(n.split(':')[1])) || (n.endsWith('시') && [...spoken].some((x) => x.startsWith(`${n.slice(0, -1)}:`))));
  sections = sections.map((s) => ({ ...s, lines: s.lines.filter(grounded).map((l) => withCite(l, claims)) }));
  return { ...st, sections: sections.filter((s) => s.lines.length) };
}

/** 글자 두 개씩 묶은 조각 (띄어쓰기·문장부호·끝말 빼고) */
const grams = (t: string) => {
  const s = plain(t).replace(/[\s.,…"“”'‘’!?~·()-]/g, '').replace(/(습니다|입니다|했어요|어요|아요|예요|이에요|에요|요)$/, '');
  const g = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2));
  return g;
};
const dice = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return a.size + b.size ? (2 * n) / (a.size + b.size) : 0; };
/**
 * 진술서 문장에 근거 문장 ID를 잇는다 (진술서 줄을 눌러 근거 트레이에 담는 데 쓴다).
 * AI에는 근거 문장 후보를 보여 주지 않는다(대화보다 사실이 많아 그대로 옮겼다). 지금 볼 수 있는 이 사람의 말 가운데 가장 비슷한 문장을 고른다
 */
function withCite(l: StatementLine, claims: Claim[]): StatementLine {
  if (l.cite?.length) return l;
  const g = grams(l.text);
  let best: Claim | null = null, score = 0;
  for (const c of claims) {
    const s = Math.max(...plain(c.text).split(/(?<=[.?!…])\s+/).map((x) => dice(g, grams(x))));
    if (s > score) { score = s; best = c; }
  }
  return best && score >= 0.45 ? { ...l, cite: [best.id] } : l;
}

/** 글 속 숫자 (시각은 12시간·24시간 둘 다로, 쉼표는 빼고). "천오백만"처럼 한글로 쓴 숫자는 세지 않는다 */
export function numbersIn(text: string): Set<string> {
  const out = new Set<string>();
  const t = plain(text).replace(/(\d),(\d{3})/g, '$1$2');
  for (const m of t.matchAll(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?|(\d{1,2}):(\d{2})/g)) {
    const h = Number(m[1] ?? m[3]), mm = m[2] ?? m[4];
    for (const x of [h % 12 || 12, (h % 12) + 12]) { out.add(`${x}시`); if (mm) out.add(`${x}:${Number(mm)}`); }
  }
  const rest = t.replace(/(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?|(\d{1,2}):(\d{2})/g, ' ');
  for (const m of rest.matchAll(/\d+/g)) out.add(m[0]);
  return out;
}

function parseStatement(text: string): unknown {
  const o = JSON.parse(text) as { sections?: unknown };
  if (!Array.isArray(o.sections)) throw new Error('sections 없음');
  return o;
}

/**
 * 바뀐 항목만 받은 정리를 이전 진술서에 끼운다. 같은 제목의 항목은 통째로 바꾸고, 새 항목은 양식의 항목 순서에 맞춰 넣는다.
 * 합친 뒤 전체를 다시 걸러 항목 사이에 겹친 문장을 뺀다.
 */
export function mergeStatement(prev: AiStatement, delta: unknown, person: PersonId, owned: Set<string>, upto: number, now = Date.now()): AiStatement {
  const changed = sanitizeStatement(delta, person, owned, upto, now).sections;
  const byTitle = new Map(prev.sections.map((s) => [s.title, s] as const));
  for (const s of changed) byTitle.set(s.title, s);
  const order = STATEMENT_FORMS[person].sections.map((s) => s.title);
  const rank = (t: string) => { const i = order.indexOf(t); return i < 0 ? order.length : i; };
  // 양식에 없는 제목("그 밖의 진술" 등)은 맨 뒤에, 원래 놓인 순서대로
  const titles = [...byTitle.keys()].map((t, i) => ({ t, i })).sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i).map((x) => x.t);
  return sanitizeStatement({ sections: titles.map((t) => byTitle.get(t)!) }, person, owned, upto, now);
}

export async function writeStatement(input: StatementInput): Promise<AiStatement> {
  const upto = settledTalk(input.chat).length;
  const mode = input.mode ?? statementMode(input);
  const text = await callAI('statement', buildStatementPrompt({ ...input, mode }), { attemptMs: 40000, hedgeMs: 20000, budgetMs: 80000, parse: parseStatement });
  const basis = statementBasis(input.person, input.owned);
  const st = mode === 'delta' && input.prev
    ? mergeStatement(input.prev, JSON.parse(text), input.person, input.owned, upto)
    : sanitizeStatement(JSON.parse(text), input.person, input.owned, upto);
  return { ...reconcileStatement(st, input.person, input.owned, settledTalk(input.chat)), basis };
}
