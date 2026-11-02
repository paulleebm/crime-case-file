import type { Action, Cond, Person } from './types';
import {
  ACTIONS, BRIEFING, DAY_END, DAY_START, DEADLINE_AT, EVIDENCE, GAPS, INITIAL, JIA_BUNDLES, JIA_CONFESSION, PERSONS,
  PRESENCE, QUESTIONS, RAIN_AT, SIDE_CASES, START_HOUR,
} from './twiceDead';
import { HINTS, LOCKED_SAY, NOPE } from './twiceDeadOrders';

// 수사 엔진. React와 무관한 순수 함수만 둔다(테스트에서 바로 돌린다).
// 시간은 2006-12-11(월) 00시부터 센 시간 단위 숫자다.

export interface Pending { id: string; at: number; from: string }
export interface LogLine { who: string; text: string }
export interface Session {
  person: string;
  suspect: boolean;
  withGrandma: boolean;
  log: LogLine[];
}

export interface ColdState {
  clock: number;
  have: string[];
  pending: Pending[];
  done: string[];         // 한 번 한 조사 항목
  visited: string[];      // 소환·방문한 적 있는 인물
  unseen: string[];       // 아직 열어 보지 않은 자료
  session: Session | null;
  morning: string[] | null; // 아침 보고 (닫으면 null)
  journal: string[];      // 수사 일지
  ending: EndingResult | null;
  orders: LogLine[];      // 반장과 주고받은 수사 지시
  stall: number;          // 새 자료·진술 없이 지나간 지시·대화 수 (힌트 시점)
  hinted: string[];       // 준 힌트 ID (최근 것이 끝)
  booked: { id: string; opts: SummonOpts }[]; // 시간이 모자라 내일 아침으로 잡아 둔 일
}

export interface SummonOpts { suspect?: boolean; withGrandma?: boolean }

export interface EndingResult {
  key: 'solved' | 'unproven' | 'grandma' | 'wrong' | 'cold';
  accused: string | null;
  charge: string | null;
  told: boolean;
  questions: { id: string; title: string; state: '증거' | '진술' | '미해결'; answer: string }[];
  side: string[];
  days: number;
}

export const evidenceById = new Map(EVIDENCE.map((e) => [e.id, e]));
export const actionById = new Map(ACTIONS.map((a) => [a.id, a]));
export const personById = new Map(PERSONS.map((p) => [p.id, p]));

export function newGame(): ColdState {
  return {
    clock: START_HOUR, have: [...INITIAL], pending: [], done: [], visited: [], unseen: [...INITIAL],
    session: null, morning: null, journal: ['12-11(월) 09:00 수사본부 회의. 사건을 넘겨받았다.'], ending: null,
    orders: [{ who: '반장', text: BRIEFING }],
    stall: 0, hinted: [], booked: [],
  };
}

export function check(c: Cond | undefined, have: Iterable<string>): boolean {
  if (!c) return true;
  const set = have instanceof Set ? have : new Set(have);
  if (c.all && !c.all.every((k) => set.has(k))) return false;
  if (c.any && c.any[1].filter((k) => set.has(k)).length < c.any[0]) return false;
  if (c.none && c.none.some((k) => set.has(k))) return false;
  return true;
}

/** 조사실 안에서는 @suspect·@gj 같은 장면 표시를 함께 본다 */
function haveSet(s: ColdState): Set<string> {
  const set = new Set(s.have);
  if (s.session?.suspect) set.add('@suspect');
  if (s.session?.withGrandma) set.add('@gj');
  return set;
}

// ── 시간 ──

const DAYS = ['월', '화', '수', '목', '금', '토', '일'];
export function clockText(h: number): string {
  const d = new Date(2006, 11, 11, 0, 0);
  d.setMinutes(Math.round(h * 60));
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const dow = DAYS[(d.getDay() + 6) % 7];
  return `${mm}-${dd}(${dow}) ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
const dayOf = (h: number) => Math.floor(h / 24);
const hourOf = (h: number) => h - dayOf(h) * 24;
export const hoursLeftToday = (s: ColdState) => DAY_END - hourOf(s.clock);
export const raining = (s: ColdState) => s.clock >= RAIN_AT;

function gain(s: ColdState, ids: string[]): string[] {
  const got = ids.filter((id) => !s.have.includes(id));
  s.have.push(...got);
  s.unseen.push(...got.filter((id) => evidenceById.has(id)));
  return got;
}

function collect(s: ColdState): string[] {
  const ready = s.pending.filter((p) => p.at <= s.clock);
  s.pending = s.pending.filter((p) => p.at > s.clock);
  const got: string[] = [];
  for (const p of ready) got.push(...gain(s, [p.id]));
  return got;
}

function spend(s: ColdState, hours: number) {
  s.clock += hours;
  collect(s);
}

// ── 조사 항목 ──

export function visibleActions(s: ColdState): Action[] {
  const set = haveSet(s);
  return ACTIONS.filter((a) => !s.done.includes(a.id) && check(a.show, set));
}

export interface StepResult { ok: boolean; say: string; got: string[] }

export function doAction(prev: ColdState, id: string): [ColdState, StepResult] {
  const s = clone(prev);
  const a = actionById.get(id);
  if (!a || s.done.includes(id) || s.ending) return [prev, { ok: false, say: '', got: [] }];
  if (!check(a.need, s.have)) return [prev, { ok: false, say: a.reason ?? '아직은 할 수 없어.', got: [] }];
  if (a.hours > hoursLeftToday(s)) return [prev, { ok: false, say: `오늘은 시간이 모자라. (${a.hours}시간 필요) 하루 마치고 내일 하자.`, got: [] }];
  const dry = !raining(s);
  spend(s, a.hours);
  s.done.push(id);
  const ids = [...a.gives, ...(dry && a.beforeRain ? a.beforeRain : [])];
  let got: string[] = [];
  if (a.wait) for (const g of ids) s.pending.push({ id: g, at: s.clock + a.wait, from: a.label });
  else got = gain(s, ids);
  s.journal.push(`${clockText(s.clock)} ${a.label}${a.wait ? ` (결과 대기 ${a.wait / 24}일)` : ''}`);
  return [s, { ok: true, say: a.say, got }];
}

// ── 하루 마치기와 아침 보고 ──

export function endDay(prev: ColdState): ColdState {
  const s = clone(prev);
  if (s.ending) return prev;
  s.session = null;
  const before = questionStates(s);
  s.clock = (dayOf(s.clock) + 1) * 24 + DAY_START;
  const got = collect(s);
  if (s.clock > DEADLINE_AT) {
    s.ending = buildEnding(s, null, null);
    return s;
  }
  const after = questionStates(s);
  const lines: string[] = [];
  lines.push(got.length ? `밤사이 들어온 결과: ${got.map((g) => evidenceById.get(g)?.title ?? g).join(', ')}.` : '밤사이 새로 들어온 결과는 없어.');
  if (s.pending.length) {
    const next = [...s.pending].sort((a, b) => a.at - b.at).map((p) => `${evidenceById.get(p.id)?.title ?? p.id}(${clockText(p.at).slice(0, 8)})`);
    lines.push(`아직 기다리는 것: ${[...new Set(next)].join(', ')}.`);
  }
  const changed = after.filter((q, i) => q.state !== before[i].state).map((q) => `${q.id} ${q.state === '증거' ? '해결' : '진술로 확인'}`);
  if (changed.length) lines.push(`의문 수첩: ${changed.join(', ')}.`);
  const suspects = suspectNames(s);
  if (suspects.length) lines.push(`지금 의심 가는 쪽: ${suspects.join(', ')}.`);
  const day = dayOf(s.clock);
  if (day === dayOf(RAIN_AT) - 1) lines.push('내일 오후부터 비 온다더라. 바깥 현장은 오늘 안에 보는 게 좋겠어.');
  else if (day === dayOf(RAIN_AT)) lines.push('오늘 오후 두 시부터 비야.');
  if (DEADLINE_AT - s.clock < 5 * 24) lines.push(`수사본부는 ${clockText(DEADLINE_AT).slice(0, 8)}까지야.`);
  let next = s;
  for (const b of s.booked) {
    const [n, said] = execId(next, b.id, b.opts, false);
    next = n;
    lines.push(`어제 잡아 둔 일: ${said.split('\n')[0]}`);
  }
  next.booked = [];
  if (next.stall >= 3) {
    const h = takeHint(next);
    if (h) lines.push(h);
  }
  next.morning = lines;
  next.journal.push(`${clockText(next.clock)} 아침 보고`);
  return next;
}

/** 지금 맞는 힌트 하나. 방금 준 것은 다른 것이 있으면 건너뛴다. 준 뒤 헛걸음 수를 0으로 */
export function nextHint(s: ColdState): { id: string; text: string } | null {
  const set = new Set([...s.have, ...s.visited.map((v) => `V:${v}`)]);
  const fit = HINTS.filter((h) => check(h.cond, set));
  if (!fit.length) return null;
  const last = s.hinted.at(-1);
  return fit.find((h) => h.id !== last) ?? fit[0];
}
function takeHint(s: ColdState): string | null {
  const h = nextHint(s);
  if (!h) return null;
  s.hinted.push(h.id);
  s.stall = 0;
  return h.text;
}

/** 지시·대화 한 번이 끝날 때: 새로 얻은 게 있으면 헛걸음 수를 0으로, 없으면 하나 늘린다 */
export function bumpStall(prev: ColdState, s: ColdState) {
  s.stall = s.have.length > prev.have.length ? 0 : (prev.stall ?? 0) + 1;
}

function suspectNames(s: ColdState): string[] {
  const out: string[] = [];
  if (s.have.includes('JA_SUS')) out.push('문지아');
  if (s.have.includes('GJ_FALSE') && !s.have.includes('GJ_BROKEN')) out.push('문경자(자백)');
  if (!out.length) {
    if (!s.have.includes('E38')) out.push('백승철');
    if (!s.have.includes('E37')) out.push('이도현');
  }
  return out;
}

// ── 조사실 ──

export function visiblePersons(s: ColdState): Person[] {
  return PERSONS.filter((p) => check(p.show, s.have));
}

export function canSummonSuspect(s: ColdState, personId: string): boolean {
  return personId === 'JA' && PRESENCE.filter((k) => s.have.includes(k)).length >= 2;
}

export function summon(prev: ColdState, personId: string, opts: { suspect?: boolean; withGrandma?: boolean } = {}): [ColdState, StepResult] {
  const p = personById.get(personId);
  if (!p || prev.ending) return [prev, { ok: false, say: '', got: [] }];
  if (opts.suspect && !canSummonSuspect(prev, personId)) return [prev, { ok: false, say: '피의자로 부르려면 그날 밤 현장에 있었다는 근거가 두 개는 있어야 해.', got: [] }];
  if (p.hours > hoursLeftToday(prev)) return [prev, { ok: false, say: `오늘은 시간이 모자라. (${p.hours}시간 필요)`, got: [] }];
  const s = clone(prev);
  spend(s, p.hours);
  if (!s.visited.includes(personId)) s.visited.push(personId);
  const suspect = !!opts.suspect || (personId === 'JA' && s.have.includes('JA_SUS'));
  s.session = { person: personId, suspect, withGrandma: personId === 'JA' && !!opts.withGrandma, log: [{ who: p.name, text: p.first }] };
  if (suspect) s.session.log.unshift({ who: '반장', text: '피의자 신분으로 조사합니다. 진술을 거부할 수 있고, 변호인을 부를 수 있습니다.' });
  if (s.session.withGrandma) s.session.log.unshift({ who: '반장', text: '보호자로 할머니가 같이 앉았어.' });
  s.journal.push(`${clockText(s.clock)} ${p.deep ? '소환' : '탐문'}: ${p.name}${suspect ? ' (피의자)' : ''}${s.session.withGrandma ? ' — 경자 동석' : ''}`);
  return [s, { ok: true, say: '', got: [] }];
}

export function topicsOf(s: ColdState) {
  if (!s.session) return [];
  const p = personById.get(s.session.person)!;
  const set = haveSet(s);
  return p.topics.filter((t) => check(t.show, set));
}

/** said: 형사가 실제로 한 말(자유 대화). 없으면 주제 이름을 형사의 말로 남긴다. voice: 준비된 답을 인물의 말투로 바꾼 대사(검사를 통과했을 때만) */
export interface TalkOpts { said?: string; voice?: (prepared: string) => string | null }

export function ask(prev: ColdState, topicId: string, opts: TalkOpts = {}): [ColdState, StepResult] {
  if (!prev.session) return [prev, { ok: false, say: '', got: [] }];
  const s = clone(prev);
  const sess = s.session!;
  const p = personById.get(sess.person)!;
  const t = p.topics.find((x) => x.id === topicId);
  if (!t || !check(t.show, haveSet(s))) return [prev, { ok: false, say: '', got: [] }];
  const line = t.lines.find((l) => check(l.cond, haveSet(s)))!;
  if (opts.said !== '') sess.log.push({ who: '나', text: opts.said ?? t.label });
  const prepared = line.text === 'CONFESSION' ? JIA_CONFESSION : line.text;
  const text = opts.voice?.(prepared) ?? prepared;
  sess.log.push({ who: line.who ?? p.name, text });
  const got = gain(s, line.gives ?? []);
  rules(s);
  return [s, { ok: true, say: text, got }];
}

export function present(prev: ColdState, evId: string, opts: TalkOpts = {}): [ColdState, StepResult] {
  if (!prev.session || !prev.have.includes(evId)) return [prev, { ok: false, say: '', got: [] }];
  const s = clone(prev);
  const sess = s.session!;
  const p = personById.get(sess.person)!;
  const set = haveSet(s);
  const hit = (p.presents ?? []).find((r) => r.ev.includes(evId) && check(r.cond, set) && (r.gives.length === 0 || r.gives.some((g) => !s.have.includes(g))));
  if (opts.said) sess.log.push({ who: '나', text: opts.said });
  sess.log.push({ who: '나', text: `(자료를 내민다) ${evidenceById.get(evId)?.title ?? evId}` });
  // 이미 반응한 자료를 다시 내밀면 한 말을 짧게 되풀이한다. 반응할 게 없는 자료는 그 자료를 받아 넘긴다
  const used = hit ? undefined : (p.presents ?? []).find((r) => r.ev.includes(evId) && check(r.cond, set) && r.gives.length > 0 && r.gives.every((g) => s.have.includes(g)));
  const title = evidenceById.get(evId)?.title ?? evId;
  const text = hit ? hit.text : used ? `(아까 한 말을 되풀이한다)\n${used.text.split('\n').find((l) => !l.startsWith('(')) ?? used.text}` : `${title}… ${p.shrug}`;
  sess.log.push({ who: hit?.who ?? (used?.who ?? p.name), text });
  const got = hit ? gain(s, hit.gives) : [];
  rules(s);
  return [s, { ok: true, say: text, got }];
}

/** 자료·진술이 쌓이면 자동으로 일어나는 일 (빈틈 두 개 → 자백이 무너짐 → 결정적 장면이면 지아 자백) */
function rules(s: ColdState) {
  const gaps = GAPS.filter((g) => s.have.includes(`GAP_${g}`)).length;
  const sess = s.session;
  if (gaps >= 2 && s.have.includes('GJ_FALSE') && !s.have.includes('GJ_BROKEN')) {
    gain(s, ['GJ_BROKEN']);
    sess?.log.push({ who: '문경자', text: '(입을 다문다. 손이 떨린다.)' });
    if (sess?.person === 'JA' && sess.withGrandma) {
      gain(s, ['JA_CONF']);
      sess.log.push({ who: '문지아', text: JIA_CONFESSION });
      sess.log.push({ who: '문경자', text: '(손녀의 손을 잡고 아무 말도 하지 않는다.)' });
      sess.log.push({ who: '반장', text: '…이 정도면 송치 의견서 쓸 수 있겠다. 남은 의문은 더 파도 되고.' });
    }
  }
}

export function leave(prev: ColdState): ColdState {
  if (!prev.session) return prev;
  const s = clone(prev);
  s.session = null;
  return s;
}

export function markSeen(prev: ColdState, id: string): ColdState {
  if (!prev.unseen.includes(id)) return prev;
  return { ...prev, unseen: prev.unseen.filter((x) => x !== id) };
}

// ── 수사 지시 (반장과의 대화) ──

/** 해석된 지시. src/cold/order.ts의 Order와 같은 모양 (엔진은 AI 모듈을 불러오지 않는다) */
export interface OrderInput {
  kind: 'order' | 'nope' | 'summary' | 'clarify' | 'culprit' | 'chat';
  ids: string[];
  reply: string;
}

/** 형사의 말을 기록하고, 해석된 지시를 하나씩 실행해 반장의 답을 남긴다 */
export function runOrder(prev: ColdState, text: string, order: OrderInput, opts: SummonOpts = {}): ColdState {
  if (prev.ending) return prev;
  let s = clone(prev);
  s.orders.push({ who: '나', text });
  const say = (t: string) => s.orders.push({ who: '반장', text: t });
  if (order.kind === 'summary') { say(summaryText(s)); return s; }
  if (order.kind === 'culprit') say('그걸 알면 우리가 여기 이러고 있겠냐. 근거로 말하자.');
  else if (order.kind === 'chat' || order.kind === 'clarify' || !order.ids.length) say(order.reply || (order.kind === 'chat' ? '그래.' : '뭘 보자는 건지 하나만 콕 집어 줘.'));
  else {
    for (const id of order.ids) {
      const [n, said] = execId(s, id, opts, true);
      s = n;
      if (said) say(said);
    }
  }
  // 헛걸음(새로 얻은 것 없는 지시·되묻기·잡담)이 길어지면 반장이 힌트를 준다
  bumpStall(prev, s);
  if (s.stall >= 6) {
    const h = takeHint(s);
    if (h) s.orders.push({ who: '반장', text: h });
  }
  return s;
}

/** 지시 하나 실행. 반장의 답을 돌려준다. canBook이면 시간이 모자랄 때 내일 아침으로 잡아 둔다 */
function execId(prev: ColdState, id: string, opts: SummonOpts, canBook: boolean): [ColdState, string] {
  let s = prev;
  const nope = NOPE.find((n) => n.id === id);
  if (nope) return [s, nope.say];
  const late = (say: string) => {
    if (!canBook || !say.startsWith('오늘은 시간이 모자라')) return [s, say] as [ColdState, string];
    const other = s.booked.find((b) => b.id.startsWith('P:') && id.startsWith('P:') && b.id !== id);
    if (other) return [s, `오늘은 시간이 모자라. 내일 아침엔 ${personById.get(other.id.slice(2))?.name}부터 잡아 놨어.`] as [ColdState, string];
    const n = clone(s);
    if (!n.booked.some((b) => b.id === id)) n.booked.push({ id, opts });
    return [n, '오늘은 시간이 모자라. 내일 아침 첫 일로 잡아 둘게.'] as [ColdState, string];
  };
  if (id.startsWith('P:')) {
    const pid = id.slice(2);
    const p = personById.get(pid);
    if (!p || !check(p.show, s.have)) return [s, '누구 말하는 건지 아직 모르겠는데.'];
    const [n, r] = summon(s, pid, { suspect: pid === 'JA' && !!opts.suspect, withGrandma: pid === 'JA' && opts.withGrandma !== false });
    if (!r.ok) return late(r.say);
    return [n, `${p.name}${p.deep ? ' 불렀어. 조사실로 가자.' : ' 만나러 가자.'}`];
  }
  const a = actionById.get(id);
  if (!a) return [s, ''];
  if (s.done.includes(id)) {
    const waiting = s.pending.some((p) => a.gives.includes(p.id));
    return [s, waiting ? `${a.label} — 그건 맡겨 놨어. 결과 기다리는 중이야.` : `${a.label} — 그건 이미 했어. 자료함에 있어.`];
  }
  if (!check(a.show, haveSet(s))) return [s, LOCKED_SAY[id] ?? '그걸 하려면 근거가 더 있어야 해.'];
  const [n, r] = doAction(s, id);
  if (!r.ok) return late(r.say);
  s = n;
  const got = r.got.map((g) => evidenceById.get(g)?.title).filter(Boolean);
  return [s, r.say + (got.length ? `\n(새 자료: ${got.join(', ')})` : a.wait ? `\n(결과는 ${a.wait >= 24 ? `${a.wait / 24}일` : `${a.wait}시간`} 뒤)` : '')];
}

function summaryText(s: ColdState): string {
  const open = questionStates(s).filter((q) => q.state !== '증거').map((q) => `${q.id} ${q.title}`);
  const lines = [`지금 ${clockText(s.clock)}. 오늘 남은 시간 ${Math.max(0, hoursLeftToday(s))}시간.`];
  lines.push(open.length ? `아직 안 풀린 것: ${open.join(', ')}.` : '의문 수첩은 다 풀렸어. 송치할 때야.');
  if (s.pending.length) lines.push(`기다리는 결과: ${[...new Set(s.pending.map((p) => evidenceById.get(p.id)?.title ?? p.id))].join(', ')}.`);
  const h = takeHint(s);
  lines.push(h ?? '어디부터 볼지는 네가 정해.');
  return lines.join('\n');
}

// ── 의문 수첩·송치·결말 ──

export function questionStates(s: ColdState) {
  return QUESTIONS.map((q) => {
    const state: '증거' | '진술' | '미해결' = q.proof.some((c) => check(c, s.have)) ? '증거' : check(q.stated ?? { all: ['__never'] }, s.have) ? '진술' : '미해결';
    return { id: q.id, title: q.title, state, answer: q.answer };
  });
}

export const ACCUSABLE = ['JA', 'GJ', 'BS', 'BJ', 'DH', 'OM', 'YH'];

export function accuse(prev: ColdState, personId: string, charge: '폭행치사' | '살인'): ColdState {
  if (prev.ending) return prev;
  const s = clone(prev);
  s.session = null;
  s.ending = buildEnding(s, personId, charge);
  s.journal.push(`${clockText(s.clock)} 송치: ${personById.get(personId)?.name} (${charge})`);
  return s;
}

function buildEnding(s: ColdState, accused: string | null, charge: string | null): EndingResult {
  let key: EndingResult['key'];
  if (!accused) key = 'cold';
  else if (accused === 'JA') key = JIA_BUNDLES.every((b) => check(b.cond, s.have)) ? 'solved' : 'unproven';
  else if (accused === 'GJ') key = 'grandma';
  else key = 'wrong';
  return {
    key, accused, charge, told: s.have.includes('TOLD'),
    questions: questionStates(s),
    side: SIDE_CASES.filter((c) => check(c.cond, s.have)).map((c) => c.title),
    days: dayOf(s.clock) - dayOf(START_HOUR) + 1,
  };
}

// ── 저장 (하루 마치기마다, 설정집 2.5) ──

export const SAVE_KEY = 'cold-case:twice-dead';
export function serialize(s: ColdState): string { return JSON.stringify({ v: 1, s }); }
export function deserialize(raw: string | null): ColdState | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    if (o?.v !== 1 || !o.s) return null;
    const s = o.s as ColdState;
    s.orders ??= [{ who: '반장', text: BRIEFING }]; // 수사 지시 대화가 생기기 전의 저장
    s.stall ??= 0; s.hinted ??= []; s.booked ??= [];
    return s;
  } catch { return null; }
}

function clone(s: ColdState): ColdState {
  return structuredClone(s);
}
