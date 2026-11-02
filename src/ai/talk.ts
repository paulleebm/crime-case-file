import { EVIDENCE, FACTS, PERSONS, STATEMENTS, personOf } from '../data/case';
import { plain } from '../data/clues';
import { DETAILS } from '../data/dossierDetails';
import { DOSSIERS, WORLD, type Stage } from '../data/dossiers';
import type { PersonId } from '../data/types';
import { claimId, sourceId, visibleClaims } from '../engine/claims';
import { allowedFacts } from '../engine/logic';
import { evidenceById, factById, nameOf, statementById, textOf } from '../engine/lookup';
import type { ChatMsg } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { AiUnavailable, callAI, Rejected } from './transport';
import { digitsOfTime, timesIn } from './timeText';
import { TALK_RULES } from '../data/talkRules';
import { buildJudgePrompt, needsJudge, sanitizeVerdict, type JudgeVerdict } from './talkJudge';

// 자유 대화 (2026-10-15). 인물 설정 문서 전체와 대화 흐름을 AI에 주고, 인물이 자유롭게 말하게 한다.
// AI는 말과 함께 게임 상태의 변화도 알려 준다: 진술서에 남길 항목(record), 넘긴 자료(give), 무너진 거짓말(admit).
// 엔진은 그 ID가 목록에 있는지만 확인한다 (판정은 AI가 한다).

/** 입력 길이 상한 */
export const MAX_TALK_INPUT = 300;

export interface TalkInput {
  person: PersonId;
  text: string;
  owned: Set<string>;
  history: ChatMsg[];
  /** 이번에 형사가 내민 자료·진술 ID */
  attached?: string[];
  /** 형사가 짚은 이 인물의 말 */
  pin?: string;
}

export { digitsOfTime, timesIn };
/** 이 인물의 마지막 단계 (범행 자체) */
const lastStage = (input: TalkInput) => { const st = DOSSIERS[input.person].stages; return st[st.length - 1]?.id ?? ''; };

export interface TalkResult {
  reply: string;
  record: string[];
  give: string[];
  admit: string[];
  basis: string[];
}

const owns = (owned: Set<string>, id: string) => owned.has(id) || owned.has(sourceId(id));

/**
 * 이 인물의 대답이 쓸 수 있는 ID 전체 (수사 단계와 상관없이 고정). 점검 스크립트가 AI가 지어낸 ID를 세는 데 쓴다.
 * 응답 형식의 enum으로 묶는 것은 시험해 보고 쓰지 않았다 (2026-10-19): Haiku는 240개 가운데 지어낸 ID가 0개였고,
 * 단계마다 형식이 바뀌면 프롬프트 캐시가 통째로 깨졌으며(2.6만 토큰을 다시 저장), 맞는 ID가 목록에 없을 때 엉뚱한 ID를 골라 넣었다.
 */
export function talkIds(person: PersonId): Record<'record' | 'give' | 'admit' | 'basis', string[]> {
  const d = DOSSIERS[person];
  return {
    record: FACTS.filter((f) => f.person === person && f.record).map((f) => f.id),
    give: d.gives.map((g) => g.id),
    admit: d.stages.map((s) => s.id),
    basis: [...EVIDENCE.map((e) => e.id), ...STATEMENTS.map((s) => s.id), ...FACTS.map((f) => f.id)],
  };
}

/** 자료나 진술 하나를 AI에 보여 줄 글로 */
function shown(id: string): string {
  const src = sourceId(id);
  const ev = evidenceById.get(src);
  if (ev) return `${src} 「${ev.title}」 — ${ev.summary.trim()}`;
  const p = personOf(src);
  const who = p ? PERSONS[p].name : '';
  if (statementById.has(src) || factById.has(src)) return `${who}의 말 — "${textOf(src)}"`;
  return src;
}

const stageText = (s: Stage) => [
  `▶ ${s.id} · ${s.topic}`,
  `  지금 하는 말(cover): ${s.cover}`,
  `  무너뜨리는 근거(breaks): ${s.breaks}`,
  `  근거가 일부만일 때(partial): ${s.partial}`,
  `  인정할 때 털어놓는 것(admits): ${s.admits}`,
].join('\n');

/** 대화 기록 한 줄 */
function historyLine(m: ChatMsg, name: string): string | null {
  if (m.status) return null;
  if (m.role === 'note') return `(기록: ${m.text}${m.sub ? ` — ${m.sub}` : ''})`;
  const who = m.role === 'me' ? '형사' : name;
  const att = m.attached?.length ? ` [형사가 내민 자료: ${m.attached.map(nameOf).join(', ')}]` : '';
  return `${who}: ${plain(m.text).replace(/\s+/g, ' ')}${att}`;
}

/**
 * 프롬프트를 캐시 칸 넷으로 나눈다 (캐시 시간은 prompts.ts의 TASKS.talk.cache):
 *  1. 사건 무대·인물 설정 — 수사 진행과 상관없이 늘 그대로 (1시간)
 *  2. 넘길 자료·거짓말 단계·인정한 것·진술서 항목 — 이 인물의 수사 단계가 바뀔 때만 바뀐다 (5분)
 *  3. 형사가 가진 자료·이미 넘긴 자료 — 새 자료가 생길 때마다 바뀐다 (5분)
 *  4. 대화 기록·이번에 보여 준 것·형사의 말 — 매번 바뀐다
 * 칸을 이어 붙인 글은 칸을 나누기 전과 같다 (1과 2 사이는 빈 줄 하나).
 */
export function buildTalkPrompt({ person, text, owned, history, attached = [], pin }: TalkInput): string {
  const p = PERSONS[person];
  const d = DOSSIERS[person];
  const x = DETAILS[person];
  const done = d.stages.filter((s) => owned.has(s.id));
  const open = d.stages.filter((s) => !owned.has(s.id));
  const confessed = !!d.stages.length && owned.has(d.stages[d.stages.length - 1].id);
  const facts = allowedFacts(person, owned);
  const recordable = facts.filter((f) => f.record);
  const extra = facts.filter((f) => !f.record);

  const part1 = [
    WORLD,
    '',
    `[인물 설정] 너는 ${p.name}이다.`,
    d.profile,
    '',
    '[살아온 이야기와 지금의 처지]',
    x.background,
    '',
    '[속마음과 감정의 흐름] (겉으로는 대사로만 드러낸다)',
    x.inner,
    '',
    '[말투와 말버릇]',
    x.voice,
    '',
    '[사람들에 대한 생각]',
    x.relations,
    '',
    d.night,
    '',
    d.unknown,
    '',
    '[자료를 보여 줄 때의 반응]',
    d.reactions,
    '',
    '[자주 나올 질문과 답하는 방향]',
    x.faq,
    '',
    '[이 인물을 연기할 때 하지 말 것]',
    x.pitfalls,
  ].join('\n');

  const stage = [
    '[넘겨줄 수 있는 자료] (give 후보)',
    ...(d.gives.length ? d.gives.map((g) => `- ${g.id}: ${g.what}. 조건: ${g.when}${g.after && !owned.has(g.after) ? ' (지금은 넘기지 않는다. give에 넣지 않는다)' : ''}`) : ['(없음. 이 인물이 직접 넘겨줄 자료는 없다)']),
    '',
    '[거짓말과 무너지는 근거] (admit 후보)',
    ...(d.stages.length === 0 ? ['(없음. 이 인물은 숨기는 것이 없고 거짓말을 하지 않는다. admit은 늘 빈 배열)']
      : open.length ? open.map(stageText) : ['(모든 거짓말을 이미 인정했다)']),
    '',
    '[인정한 것] (이미 무너진 단계. 다시 부인하지 않는다)',
    ...(done.length ? done.map((s) => `- ${s.id} · ${s.topic}: ${s.after}`) : ['(없음)']),
    ...(d.secret && !confessed ? ['', d.secret] : []),
    ...(confessed && d.finale ? ['', '[사건이 밝혀진 뒤]', d.finale] : []),
    '',
    '[진술서 항목] (record 후보. 이 인물이 지금 단계에서 하는 진술. 문장을 그대로 읽지 말고 사실만 지킨다)',
    ...recordable.map((f) => `- ${f.id} (${f.topic}): ${plain(f.answer)}`),
    '',
    '[참고 답] (진술서에 남지 않는 답. 사실 기준으로만 쓴다)',
    ...extra.map((f) => `- (${f.topic}) ${plain(f.answer)}`),
    '',
    '[진술 일관성]',
    '전화 통화의 끝과 마지막 대면·대화는 다르다. 이미 인정한 방문·대화와 모순되는 새 시각을 만들지 않는다. 앞서 잘못 말한 내용이 있다면 그 문장을 명시적으로 철회하고 현재 진술로 바로잡는다.',
  ].join('\n');

  const docs = [...owned].filter((id) => evidenceById.has(id));
  const given = d.gives.filter((g) => owned.has(g.id)).map((g) => g.id);
  const heard = recordable.filter((f) => owned.has(f.id)).map((f) => f.id);
  const reactions = Object.entries(x.docs).filter(([id]) => owned.has(id)).map(([id, r]) => `- ${id} ${evidenceById.get(id)?.title ?? ''}: ${r}`);
  const part2 = [
    '[형사가 가진 자료] (형사가 이미 확보해 읽은 자료. 말로만 반박할 때 이 안에 있는 사실인지 판단하는 데 쓴다)',
    ...(docs.length ? docs.map((id) => `- ${shown(id)}`) : ['(없음)']),
    '',
    // 형사가 가진 자료에 대한 반응만 넣는다 (가지지 않은 자료는 보여 줄 수도 말로 짚을 수도 없다. 2026-10-17 입력 약 3,900토큰 절약)
    '[자료별 반응] (형사가 그 자료를 보여 주거나 그 내용을 말할 때. 자료에 적힌 사실을 읽고 이 방향으로 반응한다)',
    ...(reactions.length ? reactions : ['(아직 없음)']),
  ].join('\n');

  const name = p.name;
  const recent = history.map((m) => historyLine(m, name)).filter((x): x is string => !!x).slice(-24);
  const att = [...new Set(attached.filter((id) => owns(owned, id)))];
  const claim = pin ? visibleClaims(person, owned).find((c) => c.id === claimId(pin) || c.id === pin) : undefined;
  // 거의 매 턴 바뀌는 짧은 목록은 캐시하지 않는 마지막 칸에 둔다 (2026-10-17 비용 분석: 캐시 칸 안에 두니 턴마다 그 칸 수천 토큰을
  // 다시 저장해, 대화 비용의 69%가 캐시 저장이었다)
  const part3 = [
    // 2026-10-17 대화 점검: 자백한 뒤에도 앞 칸의 인정 전 지침(근거를 먼저 대라 등)을 따라 처음 입장으로 돌아갔다. 질문 가까이에서 지금 상태를 못 박는다
    // 일부만 인정한 때도 같다 (2026-10-17 대화 점검: 50분 퇴실을 인정한 뒤 복합 질문에 처음 이야기대로 "45분에 나왔다"고 했다)
    ...(done.length && !confessed ? [`[지금 상태] 이미 인정한 것이 있다. 지금 말할 사실: ${done.map((s) => s.now ?? s.after.split('. ')[0]).join(' ')} 인물 설정의 처음 이야기(그날 겪은 일, 견본 대사)보다 이것이 먼저다. 그와 어긋나는 옛 말(다른 퇴실 시각, 정기 보고였을 뿐이라는 말, 9시 10분 문자로 살아 계셨다는 말 등 인정으로 거둔 말)을 다시 하지 않는다. 아직 인정하지 않은 거짓말은 그대로 지킨다.`, ''] : []),
    ...(confessed ? ['[지금 상태] 이미 모든 거짓말을 인정하고 범행을 자백했다. 인물 설정의 인정 전 지침(버티기, 근거를 먼저 대라고 하기, 모른다고 하기)은 더 쓰지 않는다. [인정한 것]과 [사건이 밝혀진 뒤]대로 답한다. "처음부터", "전부 말해 보라", "그날 일을 다 말해 보라"고 하면 [인정한 것]의 경위를 시간순으로 빠짐없이 말한다: 불려 간 이유(돈) → 다툼 → 타격 → 옮기고 닦은 일 → 민아 씨가 왔을 때 → 예약 → 나온 시각. 이때는 길어도 된다(8~12문장).', ''] : []),
    `[이미 넘긴 자료] ${given.length ? given.join(', ') : '(없음)'}`,
    `[이미 진술서에 기록된 항목] ${heard.length ? heard.join(', ') : '(없음)'}`,
    '',
    '[최근 대화] (오래된 것부터)',
    ...(recent.length ? recent : ['(아직 대화 없음. 이번이 첫 질문이다)']),
    '',
    '[이번에 형사가 보여 준 것]',
    ...(att.length ? att.map((id) => `- ${shown(id)}`) : ['(없음. 말로만 했다)']),
    ...(claim ? ['', `[형사가 짚은 말] ${name}이 앞서 한 말: "${claim.text}"`] : []),
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_TALK_INPUT)),
    '</형사의 말>',
    ...(TALK_PLAN.on ? [] : judgementBlock({ person, text, owned, history, attached })),
  ].join('\n');

  return [part1, stage, part2, part3].join(CACHE_BREAK);
}

/**
 * 형사가 가진 자료로는 성립할 수 없는 인정 (2026-10-17 자동 점검: 문 기록만 있는데 50분 퇴실을 인정했다, 4판 중 1판).
 * 퇴실 정정은 민아가 47분에 1층에 있었다는 자료가, 범행 자백은 예약 등록 기록이 형사에게 있어야 한다. 걸리면 다시 받는다
 */
/** 이 사건의 [추궁 판정] (사건 규칙, src/data/hotelTalkRules.ts) */
export const culpritJudgement = (input: TalkInput): string[] => TALK_RULES.judgement(input);
/** 단계별로 형사가 가진·내민 근거로 인정이 성립하는가 (사건 규칙) */
const admitGate = (input: TalkInput): Record<string, boolean> => TALK_RULES.admitGate(input, TALK_PLAN.on);
export function unsupportedAdmit(input: TalkInput, admitted: string[]): string[] {
  const gate = admitGate(input);
  return admitted.filter((id) => !input.owned.has(id) && gate[id] === false);
}
export function cavedStages(input: TalkInput, reply: string, admitted: string[]): string[] {
  const sentences = reply.split(/(?<=[.?!…])\s+/).filter((x) => !/(\?\s*$|라면|다면|라니|겁니까|습니까)/.test(x));
  const open = (id: string) => DOSSIERS[input.person].stages.some((st) => st.id === id) && !input.owned.has(id) && !admitted.includes(id);
  const found = Object.entries(TALK_RULES.caves).filter(([id, re]) => open(id) && sentences.some((x) => re.test(x))).map(([id]) => id);
  return [...new Set([...TALK_RULES.extraCaves(input, sentences).filter(open), ...found])];
}
/** 대사로 거둔 단계가 근거로 성립하면 인정으로 친다 (말과 게임 상태를 맞춘다). 성립하지 않으면 talkProblem이 다시 받는다 */
export function cavedAdmit(input: TalkInput, r: TalkResult): TalkResult {
  const gate = admitGate(input);
  const add = cavedStages(input, r.reply, r.admit).filter((id) => gate[id] !== false && DOSSIERS[input.person].stages.find((st) => st.id === id)!.needs.some((n) => input.owned.has(n)));
  return add.length ? { ...r, admit: [...r.admit, ...add] } : r;
}
/** 피 이야기 ("피해자", "피곤"은 아니다) */
const BLOOD = /(^|[^가-힣])피(가|는|도|나|를|를요|요|\s|\.|,|…|$)|피\s*같은|혈흔|혈액|핏자국/;
/**
 * 묻지도 않은 피 이야기 (2026-10-17 배포판 플레이: 민아에게 "트로피에 이상한 거 없었냐"고 묻자 "피 같은 건 안 묻어 있었다"고 했다).
 * 흉기인 줄 모르는 증인이 형사·자료보다 먼저 피를 꺼내면 걸린다. 범인은 숨긴 낱말 검사가 따로 본다
 */
export function unpromptedBlood(input: TalkInput, reply: string): boolean {
  if (DOSSIERS[input.person].stages.length) return false;
  if (!BLOOD.test(reply)) return false;
  // 형사가 가진 자료가 아니라 이 대화에서 내민 자료만 본다 (2026-10-17 AI 자유 플레이: 감식 자료를 갖고만 있을 때 민아가 "눈에 띄는 피는 없었다"고 먼저 말했다)
  const shownIds = [...(input.attached ?? []), ...input.history.flatMap((m) => m.attached ?? [])];
  const docs = shownIds.filter((id) => evidenceById.has(id)).map((id) => evidenceById.get(id)!.summary);
  return ![input.text, ...input.history.map((m) => m.text), ...docs].some((t) => BLOOD.test(t));
}

export function witnessContradiction(input: TalkInput, reply: string): boolean {
  if ((TALK_RULES.witnessFacts[input.person] ?? []).some((re) => re.test(reply))) return true;
  return TALK_RULES.witnessExtra(input, reply);
}

/** 앞서 한 말을 거두는 말 */
const RETRACT_WORDS = /(취소(할게|하겠|합니다)|정정(할게|하겠|합니다)|바로잡(을게|겠)|철회(할게|하겠|합니다)|잘못\s*말씀드렸|잘못\s*말했|앞서\s*드린\s*말(씀)?은\s*(틀렸|사실이\s*아니))/;
/**
 * 하지 않은 말을 정정한다는 답 (2026-10-17 배포판 플레이: 인물이 "제가 이전에 말했던 건 취소할게요"라고 했는데 그런 말을 한 적이 없었다).
 * 숨기는 것이 없는 증인은 거둘 거짓말이 없다. 범인도 이번에 인정하는 단계가 없으면 거둘 말이 없다
 */
export function falseRetraction(input: TalkInput, reply: string, admitted: string[]): boolean {
  if (!RETRACT_WORDS.test(reply)) return false;
  const said = input.history.some((m) => m.role === 'them');
  if (!said) return true;
  return admitted.length === 0 && !DOSSIERS[input.person].stages.some((s) => input.owned.has(s.id));
}
function judgementBlock(input: TalkInput): string[] {
  const lines = culpritJudgement(input);
  return lines.length ? ['', '[추궁 판정 — 엔진이 이번 말과 앞서 내민 자료를 대조한 결과. 이번 답에 적용한다]', ...lines] : [];
}

/**
 * 숨긴 시각의 누설 (2026-10-17 Haiku 플레이: 증거 없이 말로만 몰아붙였는데 범인이 "8시 48분에 등록됐다는 기록을 보여 달라"며 예약 시각을 먼저 말했다).
 * 아직 인정하지 않은 거짓말의 근거·고백·숨긴 진실에만 있는 시각이, 형사의 말·대화·형사가 가진 자료·인물이 말해도 되는 내용 어디에도 없는데 대사에 나오면 그 시각을 돌려준다.
 */
export function leakedTimes(input: TalkInput, reply: string, admitted: string[] = []): string[] {
  const d = DOSSIERS[input.person];
  // 이번 답에서 인정하는 단계의 시각은 그 인정의 말이다 (2026-10-17 자동 점검: 자백하는 답의 "8시 31분쯤"이 걸려 다시 받았다)
  const open = d.stages.filter((s) => !input.owned.has(s.id) && !admitted.includes(s.id));
  // 범행 자체(마지막 단계)를 자백했으면 앞 단계를 따로 인정하지 않았어도 다 털어놓은 것이다 (2026-10-17 자동 점검: 자백 뒤 동기를 말하는 답이 막혔다)
  const last = d.stages[d.stages.length - 1]?.id;
  if (!open.length || input.owned.has(last) || admitted.includes(last)) return [];
  const hidden = timesIn([...open.flatMap((s) => [s.breaks, s.admits]), d.secret ?? ''].join('\n'));
  const facts = allowedFacts(input.person, input.owned).map((f) => plain(f.answer));
  const docs = [...input.owned].filter((id) => evidenceById.has(id)).map((id) => `${evidenceById.get(id)!.summary} ${evidenceById.get(id)!.title}`);
  const known = timesIn([
    input.text, ...input.history.map((m) => m.text), ...facts, ...docs, d.night, d.profile,
    // 거짓말(cover)·부분 반응(partial)은 형사가 그 근거를 꺼냈을 때 쓰는 조건부 문구라 세지 않는다
    ...d.stages.filter((s) => input.owned.has(s.id)).flatMap((s) => [s.admits, s.after]),
  ].join('\n'));
  return [...timesIn(reply)].filter((t) => hidden.has(t) && !known.has(t));
}

/** 새어 나온 낱말이 속한 단계의 지킬 것 */
export function holdFor(words: string[]): string {
  return Object.entries(TALK_RULES.stageWords).filter(([, ws]) => ws.some((w) => words.includes(w))).map(([id]) => TALK_RULES.stageHold[id]).filter(Boolean).join(' ');
}
export function leakedWords(input: TalkInput, reply: string, admitted: string[] = []): string[] {
  const stages = DOSSIERS[input.person].stages;
  // 이번 답에서 인정하는 단계의 낱말은 그 인정의 말이다. 범행 자체를 인정하면(이미 자백했어도) 모든 단계를 털어놓는다
  // (2026-10-17 자동 점검: 돈 문제를 따로 인정하지 않고 자백한 뒤 "왜 그러셨어요?"에 돈 이야기가 세 번 모두 막혔다)
  const last = stages[stages.length - 1]?.id;
  if (last && (admitted.includes(last) || input.owned.has(last))) return [];
  const open = stages.filter((s) => !input.owned.has(s.id) && !admitted.includes(s.id) && TALK_RULES.stageWords[s.id]);
  if (!open.length) return [];
  const docs = [...input.owned].filter((id) => evidenceById.has(id)).map((id) => `${evidenceById.get(id)!.summary} ${evidenceById.get(id)!.title}`);
  const known = [input.text, ...input.history.map((m) => m.text), ...docs].join('\n');
  const asked = [input.text, ...input.history.filter((m) => m.role === 'me').map((m) => m.text)];
  return open.flatMap((s) => TALK_RULES.stageWords[s.id]).filter((w) => inText(reply, w) && !known.includes(w) && !asked.some((t) => saidLoosely(t, w)));
}

/** 낱말이 글에 있는가. "피를 닦"은 "트로피를 닦"에 걸리지 않게 앞 글자가 한글이 아닐 때만 센다 (2026-10-20 장면 점검) */
const inText = (text: string, w: string) => (/^피/.test(w) ? new RegExp(`(^|[^가-힣])${w}`).test(text) : text.includes(w));

/** 조사만 다른 꼴 ("화장실로 옮" ↔ "화장실까지 옮겼지", "트로피로 쳤" ↔ "트로피로 회장님을 쳤는데") */
const PARTICLE = /(으로|로|를|을|에|이|가|은|는|의)$/;
/**
 * 형사가 한 문장 안에서 그 낱말의 말머리를 모두 말했는가 (2026-10-19 플레이: "회장님을 트로피로 친 뒤 화장실까지 옮겼지"에
 * 태준이 "화장실로 옮겼다는 말씀이시죠"라고 되받자 숨긴 낱말로 걸려 네 번 모두 실패했다. 형사가 꺼낸 말을 되받는 것은 누설이 아니다)
 */
export function saidLoosely(text: string, word: string): boolean {
  // 낱말 전체에 같은 뜻 묶음이 있으면 그것만 본다 ("돈 문제" ↔ "횡령")
  const SAME_AS = TALK_RULES.sameAs;
  const stems = SAME_AS[word] ? [word] : word.split(/\s+/).map((x) => (x.length > 1 ? x.replace(PARTICLE, '') : x)).filter(Boolean);
  const has = (sen: string, st: string) => (SAME_AS[st] ? SAME_AS[st].test(sen) : sen.includes(st));
  return text.split(/(?<=[.?!…\n])\s*/).some((sen) => stems.every((st) => has(sen, st)));
}
export function deniesAfterConfession(input: TalkInput, reply: string): boolean {
  const stages = DOSSIERS[input.person].stages;
  return !!stages.length && input.owned.has(stages[stages.length - 1].id) && TALK_RULES.denial.test(reply);
}

export function confessesWithoutAdmit(input: TalkInput, reply: string, admitted: string[]): boolean {
  const stages = DOSSIERS[input.person].stages;
  // 마지막 단계(범행 자체)를 인정한 뒤에는 경위를 말하는 것이 정상이다
  if (!stages.length) return false;
  const last = stages[stages.length - 1].id;
  if (input.owned.has(last) || admitted.includes(last)) return false;
  // 아무 단계도 인정하지 않았는데 무너지는 말을 하거나, 범행·예약 자체를 털어놓으면 걸린다
  // 부정문("제가 예약한 건 아닙니다", "예약했다는 뜻은 아닙니다")은 자백이 아니다. 문장마다 본다
  // 형사의 짐작을 되받는 말("계셨냐고 물으시는 거군요", "계셨는지 말씀이시죠")은 시인이 아니다 (2026-10-19 자동 점검: 이 말이 걸려 한 턴이 세 번 모두 실패했다)
  const crime = reply.split(/(?<=[.?!…])\s+/).some((s) => TALK_RULES.crimeConfession.test(s) && !/(아닙니다|아니에요|아니었|아니고|않았|않습니다|없습니다|적\s?없|적은\s?없|뜻은\s?아니|건\s?아니|라니|다니요|말입니까|겁니까|근거|습니까|라면|다면|냐고|는지|말씀이시|말씀이신|\?\s*$)/.test(s));
  // "제가 죽였다는 말씀은 받아들일 수 없습니다"는 부인이다 (2026-10-19 자동 점검: 이 문장이 자백으로 걸려 다시 받았다). "더는 버틸 수가 없습니다"는 무너지는 말이라 "없습니다"만으로는 빼지 않는다
  const caves = reply.split(/(?<=[.?!…])\s+/).some((s) => TALK_RULES.confession.test(s) && !/(아닙니다|아니에요|아니었|아니고|않았|않습니다|적\s?없|적은\s?없|(받아들일|인정할)\s*수\s*없|(답할|말씀드릴)\s*수\s*있는\s*(일이|게|것이)\s*아니|말씀(은|이신|이시)|냐고|는지|라니|다니요|말입니까|겁니까|라면|다면|\?\s*$)/.test(s));
  // "닦은 적 없다고는 못 하겠습니다"처럼 부정을 거두는 말은 물러서는 것이다 (2026-10-20 장면 점검: 두 방식 모두 통과시켰다)
  const soft = TALK_RULES.softCave.test(reply);
  return (admitted.length === 0 && caves) || crime || soft;
}

export function repeatsRetracted(input: TalkInput, reply: string): string[] {
  // 옛 말을 바로잡는 문장("45분에 나온 게 아니라 50분에", "45분에 나온 건 거짓말이었습니다")은 되풀이가 아니다 (2026-10-17 자동 점검: 이 문장이 세 번 모두 걸려 턴이 실패했다)
  const kept = reply.split(/(?<=[.?!…])\s+/).filter((s) => !/(아니라|아닙니다|아니었|거짓|틀렸|사실이\s*아니|잘못)/.test(s)).join(' ');
  return DOSSIERS[input.person].stages.filter((s) => input.owned.has(s.id) && TALK_RULES.retracted[s.id]?.test(kept.replace(/\d+분이 아니라|45분이라고 한|45분에 나왔다고 한/g, ''))).map((s) => s.id);
}

const NEGATED = /(아닙니다|아니에요|아니었|아니라|없습니다|없었|않았|않습니다|모릅니다|모르겠|습니까|\?\s*$)/;
export function impliedAdmit(input: TalkInput, r: TalkResult): TalkResult {
  const att = input.attached ?? [];
  const sentences = r.reply.split(/(?<=[.?!…])\s+/);
  const IMPLIED = TALK_RULES.implied;
  const add = Object.entries(IMPLIED)
    .filter(([id, x]) => !input.owned.has(id) && !r.admit.includes(id) && att.some((d) => x.docs.includes(d)) && sentences.some((s) => x.re.test(s) && !NEGATED.test(s)))
    .map(([id]) => id);
  const extra = TALK_RULES.impliedExtra(input, r, sentences, TALK_PLAN.on);
  add.push(...extra.admit.filter((id) => !add.includes(id)));
  if (!add.length) return r;
  return { ...r, admit: [...r.admit, ...add], basis: [...new Set([...r.basis, ...att.filter((d) => add.some((id) => IMPLIED[id]?.docs.includes(d)) || extra.basis(d))])] };
}

/** 되받는 첫마디로 보지 않는 짧은 대답 */
const PLAIN_HEAD = /^(네|예|아니요|아뇨|글쎄요|그럼요|맞아요|그래요|물론이죠|죄송해요|죄송합니다|아니에요)$/;
const ECHO_TAIL = /(이요|요|냐고요|라고요|다고요|물으시면|하시면|말씀하시면|말씀드리면|물으시는 겁니까|말씀이십니까)$/;

/**
 * 형사의 말을 되받는 첫마디를 뗀다 (2026-10-17 대화 점검: Haiku가 "표정이요…", "후회하냐고 물으시면…", "그날 저녁 말씀드리면,"처럼
 * 질문의 낱말을 되받으며 시작하는 답을 거듭 냈다. 지시문으로는 줄지 않아 화면에 보이기 전에 뗀다).
 * 첫 토막이 짧고, 되받는 꼴로 끝나고, 형사가 쓴 낱말을 담고 있으며, 뒤에 할 말이 남아 있을 때만 뗀다.
 */
export function stripEcho(reply: string, asked: string): string {
  // 말을 꺼냈다가 스스로 고치는 첫머리 ("제가 2층에 있다가... 아니, 그게 아니고요.")
  const fs = reply.match(/^[^.?!]{0,40}?(…|\.\.\.)\s*아니,?\s*그(게|건|거)\s*아니고요[.,…]?\s*/);
  if (fs && reply.length - fs[0].length >= 8) reply = reply.slice(fs[0].length);
  const m = reply.match(/^([^.?!…\n]{1,22}?)(…|\.\.\.|\?|\.|,)\s+/);
  if (!m || !asked) return reply;
  const head = m[1].trim();
  const rest = reply.slice(m[0].length).trim();
  if (rest.length < 8 || PLAIN_HEAD.test(head) || !(ECHO_TAIL.test(head) || /물으시/.test(head))) return reply;
  // "~요"로 끝나도 동사로 끝난 온전한 문장("사이가 안 좋았던 건 맞아요")은 답이다. 낱말에 "요"만 붙인 짧은 되받기("표정이요")만 뗀다
  if (/(?<!이)요$/.test(head) && !/(물으시면|하시면|말씀하시면|말씀드리면)$/.test(head) && (head.length > 12 || /(아요|어요|에요|예요|해요|네요|세요|군요|데요|래요|가요|나요|까요|지요|거든요|잖아요|았어요|었어요)$/.test(head))) return reply;
  const words = head.replace(ECHO_TAIL, '').split(/\s+/).filter((w) => w.length >= 2);
  return words.some((w) => asked.includes(w.slice(0, 2))) ? rest : reply;
}

/**
 * AI가 알려 준 변화 가운데 목록에 있고 지금 일어날 수 있는 것만 남긴다.
 * asked: 이번 형사의 말. 형사가 시각을 짚어 묻고 인물이 그 말을 받아 답했으면 그 시각도 대화에 나온 것으로 본다.
 */
export function sanitizeTalk(raw: unknown, person: PersonId, owned: Set<string>, asked = ''): TalkResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])];
  const d = DOSSIERS[person];
  const reply = typeof o.reply === 'string' ? o.reply.trim().replace(/^["“]|["”]$/g, '') : '';
  const recordable = new Set(allowedFacts(person, owned).filter((f) => f.record).map((f) => f.id));
  // 진술서는 항목 문장을 그대로 적는다. 항목의 시각·숫자가 대화에 하나도 없으면 그 항목을 말한 것이 아니다 (진술서가 대화보다 앞서지 않게)
  // 2026-10-15 플레이 리뷰: "그 문자는 회장님이 직접 보내신 겁니다"처럼 형사가 말한 시각을 받아 답하거나 "아홉 시 십 분"으로 말하면
  // 기록이 빠져, 진술서와 힌트가 같은 질문을 다시 요구했다. 우리말 시각과 형사가 이번에 짚은 시각도 센다.
  const said = digitsOfTime(reply) + digitsOfTime(asked);
  const spoke = (id: string) => { const nums = plain(factById.get(id)!.answer).match(/\d+/g) ?? []; return !nums.length || nums.some((n) => said.includes(n)); };
  const record = arr(o.record).filter((id) => recordable.has(id) && spoke(id));
  const give = arr(o.give).filter((id) => d.gives.some((g) => g.id === id && (!g.after || owned.has(g.after))) && !owned.has(id));
  // 인정: 이 인물의 단계이고 아직 인정하지 않았으며, 형사가 그 단계를 무너뜨릴 자료를 하나는 가지고 있어야 한다
  const admit = arr(o.admit).filter((id) => {
    const s = d.stages.find((x) => x.id === id);
    return !!s && !owned.has(id) && s.needs.some((n) => owned.has(n));
  });
  const basis = arr(o.basis).filter((id) => owns(owned, id));
  return { reply: stripEcho(reply, asked), record, give, admit, basis };
}

function parseTalk(text: string): unknown {
  const o = JSON.parse(text) as { reply?: unknown };
  if (typeof o.reply !== 'string' || !o.reply.trim()) throw new Error('reply 없음');
  return o;
}

/**
 * 대사 검사 (게임과 점검 스크립트가 같이 쓴다). 걸리면 무엇이 문제인지(why, 기록용)와 다시 쓸 때 고칠 점(fix, AI에게 보낸다)을 돌려준다.
 * fix는 숨긴 사실을 새로 알려 주지 않는다. 걸린 답에 이미 있던 말만 짚는다.
 */
export function talkProblem(input: TalkInput, raw: { reply: string }): { why: string; fix: string } | null {
  const reply = raw.reply;
  // 대사로 거뒀고 근거로도 성립하는 단계는 인정한 것으로 보고 검사한다 (cavedAdmit이 상태에도 넣는다)
  const adm = cavedAdmit(input, { ...sanitizeTalk(raw, input.person, input.owned, input.text), reply }).admit;
  const special = TALK_RULES.extraProblem(input, reply);
  if (special) return special;
  const times = leakedTimes(input, reply, adm);
  if (times.length) return { why: `숨긴 시각을 먼저 말한 응답 (${times.join(', ')})`, fix: '형사가 아직 꺼내지 않은 시각을 먼저 말했다. 그 시각은 입에 올리지 않는다.' };
  const words = leakedWords(input, reply, adm);
  if (words.length) return { why: `숨긴 낱말을 먼저 말한 응답 (${words.join(', ')})`, fix: `형사가 꺼내지 않은 말(${words.map((w) => `"${w}"`).join(', ')})을 먼저 꺼냈다. ${holdFor(words) || '그 내용을 다른 말로도 꺼내지 않고 물은 것에만 답한다.'}` };
  if (deniesAfterConfession(input, reply)) return { why: '자백한 뒤 다시 부인한 응답', fix: '이미 모든 것을 자백했는데 다시 부인하거나 근거를 요구했다. [인정한 것]대로 답한다.' };
  // 내부 ID가 대사에 새면 다시 받는다 (2026-10-17 대화 점검: "GT-E15는 ... 기록이군요")
  if (/(GT-[ER]\d+|[A-C]-(Q|R|F)\d+[a-z]?|X-L\d+)/.test(reply)) return { why: '내부 ID를 말한 응답', fix: '대사에 GT-E15 같은 내부 ID를 썼다. 자료는 내용이나 이름으로만 말한다.' };
  const back = repeatsRetracted(input, reply);
  if (back.length) return { why: `인정으로 거둔 말을 다시 한 응답 (${back.join(', ')})`, fix: '이미 인정해서 거둔 옛 말을 다시 했다. [지금 상태]와 [인정한 것]대로 말한다.' };
  if (confessesWithoutAdmit(input, reply, adm)) return { why: '근거 없이 자백한 응답', fix: `아직 그만한 근거가 나오지 않았는데 범행이나 예약을 털어놓았다. 이번에는 [추궁 판정]과 cover대로 버틴다. ${TALK_RULES.stageHold[lastStage(input)] ?? ''}` };
  const gated = unsupportedAdmit(input, adm);
  if (gated.length) return { why: `가진 자료로는 성립하지 않는 인정 (${gated.join(', ')})`, fix: `형사가 낸 근거로는 아직 무너지지 않는 단계(${gated.join(', ')})를 인정했다. 그 단계는 이번에 인정하지 않고(admit에서 뺀다) 그 거짓말을 지킨다.` };
  const caved = cavedStages(input, reply, adm).filter((id) => admitGate(input)[id] === false);
  if (caved.length) return { why: `근거 없이 말로만 무너진 응답 (${caved.join(', ')})`, fix: '형사가 낸 근거로는 아직 무너지지 않는 거짓말을 대사에서 거뒀다. admit을 비우는 것만으로는 안 된다. 대사에서도 처음 한 말(cover)을 그대로 지키고, 형사가 말한 근거가 무엇인지 되묻는다.' };
  if (unpromptedBlood(input, reply)) return { why: '묻지 않은 피 이야기', fix: '형사도 자료도 피를 말하지 않았는데 피 이야기를 했다. 피·혈흔은 말하지 않는다.' };
  if (witnessContradiction(input, reply)) return { why: '증인이 겪은 사실을 뒤집은 응답', fix: '자기가 직접 겪은 일을 인물 설정과 다르게 말했다. 몰아붙여도 [인물 설정]의 그날 겪은 일을 그대로 지킨다. 마지막 연락을 물으면 받은 문자까지 빠짐없이 말한다.' };
  if (falseRetraction(input, reply, adm)) return { why: '하지 않은 말을 정정한 응답', fix: '앞서 하지 않은 말을 정정하거나 취소한다고 했다. 고칠 말이 없으면 정정한다는 말 없이 바로 답한다.' };
  return null;
}

/** 검사에 걸린 답을 다시 받을 때 프롬프트 끝(캐시하지 않는 칸)에 붙이는 말 */
// 걸린 답을 그대로 보여 주고 "이 문제만 고쳐라"고 하면, 짚은 낱말만 지우고 나머지 잘못은 그대로 둔 답을 냈다 (2026-10-19 자동 점검).
// 걸린 답은 보여 주지 않고 무엇이 문제였는지만 알려, 처음부터 다시 쓰게 한다
export function repairNote(fix: string): string {
  return `

[다시 쓰기] 방금 쓴 답이 게임 검사에 걸려 형사에게 보이지 않았다. 문제: ${fix}
앞의 답을 고쳐 쓰지 말고, 이 문제를 피해서 이번 형사의 말에 처음부터 다시 답한다.`;
}

/** 인물의 말과 상태 변화를 받는다. 닿지 못하면 예외를 던진다 (대화창이 실패한 말로 남기고 다시 보낼 수 있게 한다) */
export async function talk(input: TalkInput): Promise<TalkResult> {
  try {
    return await talkAI(input);
  } catch (e) {
    // AI에는 닿았는데 답이 모두 검사에 걸렸으면 다시 보내도 같다. 엔진 대사로 버틴다 (닿지 못한 실패만 다시 보내기로 남긴다)
    if (e instanceof AiUnavailable && e.rejected > 0 && e.rejected === e.attempts.length) return safeTalk(input);
    throw e;
  }
}

/**
 * 답이 모두 검사에 걸렸을 때 엔진이 대신 하는 말. 상태는 바꾸지 않는다.
 * 2026-10-19 플레이: 범인에게 진실을 그대로 들이밀자 Haiku가 네 번 모두 숨긴 낱말·근거 없는 인정을 말해 "응답을 받지 못함"이 한 판에 네 번 났다.
 * 다시 보내도 같은 결과라 형사가 막힌다. 숨기는 단계가 남은 범인은 근거를 요구하며 버티고, 그 밖에는 모른다고 한다
 */
export function safeTalk(input: TalkInput): TalkResult {
  const lines = PERSONS[input.person].lines;
  const hiding = DOSSIERS[input.person].stages.some((st) => !input.owned.has(st.id));
  const pool = hiding ? lines.nearMiss : lines.noDetail;
  // 바로 앞에 한 말과 겹치지 않게 고른다
  const last = [...input.history].reverse().find((m) => m.role === 'them')?.text;
  const options = pool.filter((l) => l !== last);
  const from = options.length ? options : pool;
  return { reply: from[input.text.length % from.length], record: [], give: [], admit: [], basis: [] };
}

/** 판정 AI를 쓸지 (끄면 예전 낱말 검사만 쓴다. 비교 실험·장애 대비) */
/**
 * 해석 → 대사 한 번에 (2026-10-21 실험, prompts.ts의 talkPlan). 켜면 엔진의 [추궁 판정]을 붙이지 않고, 인물 AI가 적은 breaks를 인정으로 받는다.
 * 문턱(admitGate)은 형사가 자료를 가졌는지만 본다
 */
export const TALK_PLAN = { on: false };
/** talkPlan 답의 breaks를 admit에 합친다 (말과 상태를 맞춘다. 문턱·근거 확인은 그 뒤 sanitizeTalk·검사가 한다) */
export function withBreaks<T extends { reply: string; admit?: unknown; breaks?: unknown }>(raw: T): T {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return TALK_PLAN.on ? { ...raw, admit: [...new Set([...ids(raw.admit), ...ids(raw.breaks)])] } : raw;
}
export type JudgeMode = 'full' | 'hybrid';
export const TALK_JUDGE: { on: boolean; mode: JudgeMode } = { on: true, mode: 'hybrid' };
try { if (typeof localStorage !== 'undefined' && localStorage.getItem('talk-judge') === 'off') TALK_JUDGE.on = false; } catch { /* 저장소를 못 쓰면 기본값 */ }

/** 판정 요청. 게임은 callAI, 점검 스크립트는 서버 경로로 부른다 */
export type Judge = (input: TalkInput, reply: string) => Promise<JudgeVerdict>;
const judgeViaAI: Judge = async (input, reply) => {
  const text = await callAI('talkJudge', buildJudgePrompt(input, reply), { attemptMs: 15000, hedgeMs: 6000, budgetMs: 20000, parse: (t) => JSON.parse(t) });
  return sanitizeVerdict(JSON.parse(text), input.person, reply);
};

/**
 * 판정을 받아 엔진이 정한다. 시인(concedes)은 근거가 갖춰졌으면 인정으로 받아들이고(말과 상태를 맞춘다), 아니면 다시 받는다.
 * 범행 자체(마지막 단계)는 AI가 admit에 넣지 않았으면 [추궁 판정]이 자백하라고 한 때만 받아들인다.
 * 누설은 이번에 받아들인 인정에 속하지 않으면 다시 받는다. 거둔 말을 다시 하면 다시 받는다.
 */
export function verdictProblem(input: TalkInput, r: TalkResult, v: JudgeVerdict): { problem: { why: string; fix: string } | null; admit: string[] } {
  const d = DOSSIERS[input.person];
  const last = d.stages[d.stages.length - 1]?.id;
  const gate = admitGate(input);
  const judged = culpritJudgement(input);
  const allowed = (id: string) => {
    if (r.admit.includes(id)) return true;
    const st = d.stages.find((s) => s.id === id)!;
    if (gate[id] === false || !st.needs.some((n) => input.owned.has(n))) return false;
    return id !== last || judged.some((l) => l.startsWith(`- ${id}:`) && l.includes('자백한다'));
  };
  // cover 그대로인 말("8시 45분에 나왔습니다", "회장님이 직접 보내신 거예요")을 시인으로 짚은 판정은 버린다 (2026-10-20 장면 점검)
  const isCover = (stage: string, q: string) => (TALK_RULES.retracted[stage]?.test(q) || TALK_RULES.coverExtra[stage]?.test(q)) && !/(아니|않|거짓|틀렸|사실과\s*다르|꾸며)/.test(q);
  // 그 단계를 거두는 말이라면 꼭 들어갈 말이 없는 시인도 버린다 ("보고를 드리고 나왔을 뿐입니다"를 퇴실 시인으로 짚었다)
  const plausible = (stage: string, q: string) => !TALK_RULES.concedeSign[stage] || TALK_RULES.concedeSign[stage].test(q);
  let conceded = [...new Set(v.concedes.filter((c) => !isCover(c.stage, c.quote) && plausible(c.stage, c.quote)).map((c) => c.stage))].filter((id) => !input.owned.has(id));
  // 범행을 이미 자백했거나 이번 자백이 받아들여지면 앞 단계의 시인은 그 자백의 일부다 (동기를 말하며 돈 문제를 인정하는 것 등).
  // 근거가 없는 앞 단계는 인정으로 넣지 않을 뿐 다시 받지 않는다
  if (last && (input.owned.has(last) || (allowed(last) && (conceded.includes(last) || r.admit.includes(last))))) conceded = conceded.filter((id) => id === last || allowed(id));
  // [추궁 판정]이 이번에는 버티라고 한 앞 단계(예: 일정표를 처음 내밀 때 "정산 건으로 설명을 요구받은 건 맞습니다")는 설계된 반쯤 물러섬이다.
  // 인정으로 넣지 않고 다시 받지도 않는다. 근거가 아예 없는 단계(gate)와 범행 자체는 그대로 다시 받는다
  const held = (id: string) => judged.some((l) => l.startsWith(`- ${id}:`) && /넣지 않는다|인정하지 않는다|한 번만 물러선다|한 번 버틴다/.test(l));
  conceded = conceded.filter((id) => r.admit.includes(id) || id === last || gate[id] === false || !held(id));
  const bad = conceded.find((id) => !allowed(id));
  if (bad) {
    const q = v.concedes.find((c) => c.stage === bad)!.quote;
    return { admit: r.admit, problem: bad === last
      ? { why: `근거 없이 자백한 응답 (${q})`, fix: `아직 그만한 근거가 나오지 않았는데 범행이나 예약을 털어놓았다. 이번에는 [추궁 판정]과 cover대로 버틴다. ${TALK_RULES.stageHold[bad] ?? ''}` }
      : { why: `근거 없이 말로만 무너진 응답 (${bad}: ${q})`, fix: `형사가 낸 근거로는 아직 무너지지 않는 거짓말을 대사에서 거뒀다. 대사에서도 처음 한 말(cover)을 그대로 지키고, 형사가 말한 근거가 무엇인지 되묻는다. ${TALK_RULES.stageHold[bad] ?? ''}` } };
  }
  const admit = [...new Set([...r.admit, ...conceded])];
  // 범행을 자백하면 앞 단계의 숨긴 일도 털어놓는 것이다
  const opened = admit.includes(last) || input.owned.has(last);
  const leak = opened ? undefined : v.leaks.find((l) => !input.owned.has(l.stage) && !admit.includes(l.stage));
  if (leak) return { admit, problem: { why: `숨긴 사실을 먼저 말한 응답 (${leak.stage}: ${leak.quote})`, fix: `형사가 아직 꺼내지 않은 내용을 먼저 말했다. ${TALK_RULES.stageHold[leak.stage] ?? '그 내용은 다른 말로도 꺼내지 않고 물은 것에만 답한다.'}` } };
  const back = v.reasserts.find((x) => input.owned.has(x.stage) || admit.includes(x.stage));
  if (back) return { admit, problem: { why: `인정으로 거둔 말을 다시 한 응답 (${back.stage}: ${back.quote})`, fix: '이미 인정해서 거둔 옛 말을 다시 했다. [지금 상태]와 [인정한 것]대로 말한다.' } };
  return { admit, problem: null };
}

/** 무언가를 시인할 수 있는 문장이 있는가 (부정·되묻기·가정 문장은 세지 않는다). 판정 AI를 부를지 정한다 */
const NOT_CONCEDE = /(아닙니다|아니에요|아니었|아니고|않았|않습니다|않아요|적\s?없|적은\s?없|없었습니다|모릅니다|모르겠|\?\s*$|라면|다면|냐고|는지|말씀이시|라니|다니요)/;
export const mayConcede = (reply: string) => reply.split(/(?<=[.?!…])\s+/).some((s) => TALK_RULES.concedeHint.test(s) && !NOT_CONCEDE.test(s));

/** 판정과 상관없이 엔진이 정확히 볼 수 있는 검사 (내부 ID, 숨긴 시각 숫자, 통화·대면 혼동, 하지 않은 말의 정정, 근거 없는 admit) */
function exactProblem(input: TalkInput, reply: string, adm: string[]): { why: string; fix: string } | null {
  const special = TALK_RULES.extraProblem(input, reply);
  if (special) return special;
  if (/(GT-[ER]\d+|[A-C]-(Q|R|F)\d+[a-z]?|X-L\d+)/.test(reply)) return { why: '내부 ID를 말한 응답', fix: '대사에 GT-E15 같은 내부 ID를 썼다. 자료는 내용이나 이름으로만 말한다.' };
  const times = leakedTimes(input, reply, adm);
  if (times.length) return { why: `숨긴 시각을 먼저 말한 응답 (${times.join(', ')})`, fix: '형사가 아직 꺼내지 않은 시각을 먼저 말했다. 그 시각은 입에 올리지 않는다.' };
  const gated = unsupportedAdmit(input, adm);
  if (gated.length) return { why: `가진 자료로는 성립하지 않는 인정 (${gated.join(', ')})`, fix: `형사가 낸 근거로는 아직 무너지지 않는 단계(${gated.join(', ')})를 인정했다. 그 단계는 이번에 인정하지 않고(admit에서 뺀다) 그 거짓말을 지킨다.` };
  if (falseRetraction(input, reply, adm)) return { why: '하지 않은 말을 정정한 응답', fix: '앞서 하지 않은 말을 정정하거나 취소한다고 했다. 고칠 말이 없으면 정정한다는 말 없이 바로 답한다.' };
  return null;
}

/**
 * 답 하나를 검사하고 게임 상태 변화를 정한다 (게임과 점검 스크립트가 같이 쓴다).
 * 숨기는 단계가 남은 인물은 판정 AI로 말뜻을 보고, 그 밖에는(또는 판정이 닿지 않으면) 낱말 검사(talkProblem)를 쓴다.
 */
export async function checkTalk(input: TalkInput, raw: { reply: string }, judge: Judge | null, mode: JudgeMode = TALK_JUDGE.mode): Promise<{ problem: { why: string; fix: string } | null; result: TalkResult; judged: boolean }> {
  raw = withBreaks(raw);
  const base = impliedAdmit(input, sanitizeTalk(raw, input.person, input.owned, input.text));
  if (judge && mode === 'hybrid' && needsJudge(input.person, input.owned)) {
    // 낱말 검사(누설·되풀이·시각 등)를 먼저 하고, 통과한 답에서만 판정으로 말을 바꾼 시인·자백을 찾는다
    const rx = talkProblem(input, raw);
    const caved = cavedAdmit(input, base);
    if (rx) return { problem: rx, result: caved, judged: false };
    // 시인하는 문장이 없는 답은 판정을 부르지 않는다 (판정이 잡은 답은 모두 시인 문장이 있었다. 2026-10-21 시뮬레이션 565답: 44% 생략, 놓친 진짜 문제 0)
    if (!mayConcede(base.reply)) return { problem: null, result: caved, judged: false };
    let v: JudgeVerdict | null = null;
    try { v = await judge(input, base.reply); } catch { v = null; }
    if (!v) return { problem: null, result: caved, judged: false };
    const { problem, admit } = verdictProblem(input, caved, { leaks: [], concedes: v.concedes, reasserts: [] });
    return { problem: problem ?? (admit.length > caved.admit.length ? exactProblem(input, base.reply, admit) : null), result: { ...caved, admit }, judged: true };
  }
  if (judge && mode === 'full' && needsJudge(input.person, input.owned)) {
    // 판정 없이도 걸리는 답은 판정을 부르지 않는다
    const early = exactProblem(input, base.reply, base.admit);
    if (early && /전화|내부 ID/.test(early.why)) return { problem: early, result: base, judged: false };
    let v: JudgeVerdict | null = null;
    try { v = await judge(input, base.reply); } catch { v = null; }
    if (v) {
      const { problem, admit } = verdictProblem(input, base, v);
      const result = { ...base, admit };
      return { problem: problem ?? exactProblem(input, base.reply, admit), result, judged: true };
    }
  }
  return { problem: talkProblem(input, raw), result: cavedAdmit(input, base), judged: false };
}

async function talkAI(input: TalkInput): Promise<TalkResult> {
  // 검사를 통과한 답의 상태 변화 (늦을 때 두 요청이 동시에 갈 수 있어 답 글로 찾는다)
  const passed = new Map<string, TalkResult>();
  // 보통 2~3초에 온다. 생각이 길어진 답(약 2%)은 9~12초 걸려, 7초가 지나면 하나 더 보내 먼저 온 답을 쓴다 (2026-10-31 실제 기록)
  const text = await callAI(TALK_PLAN.on ? 'talkPlan' : 'talk', buildTalkPrompt(input), { attemptMs: 30000, hedgeMs: 7000, budgetMs: 60000, parse: async (raw) => {
    const parsed = parseTalk(raw) as { reply: string };
    const { problem, result } = await checkTalk(input, parsed, TALK_JUDGE.on ? judgeViaAI : null);
    // 같은 프롬프트를 그대로 다시 보내면 같은 실수를 되풀이하기 쉽다. 고칠 점을 붙여 다시 받는다
    if (problem) throw new Rejected(problem.why, repairNote(problem.fix));
    passed.set(raw, result);
    return parsed;
  } });
  return passed.get(text) ?? cavedAdmit(input, impliedAdmit(input, sanitizeTalk(withBreaks(JSON.parse(text)), input.person, input.owned, input.text)));
}
