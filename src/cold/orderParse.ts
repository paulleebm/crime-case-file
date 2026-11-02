import { CACHE_BREAK, noBreak } from '../ai/prompts';
import { evidenceById, type ColdState } from './engine';
import { ACTIONS, PERSONS } from './twiceDead';
import { ACTION_WORDS, NOPE, PERSON_WORDS } from './twiceDeadOrders';

// 수사 지시 해석. 형사가 반장에게 한 말을 조사 항목(F01…)·인물(P:CM…)·안 되는 조사(N:…) ID로 옮긴다.
// 여기는 AI를 부르지 않는 부분(프롬프트·검사·낱말 해석)이다. 부르는 곳은 order.ts. 무엇을 줄지는 엔진의 runOrder가 정한다.

export const MAX_ORDER_INPUT = 200;

export type OrderKind = 'order' | 'nope' | 'summary' | 'clarify' | 'culprit' | 'chat';
export interface Order { kind: OrderKind; ids: string[]; reply: string; via: 'ai' | 'words' }

const KINDS: OrderKind[] = ['order', 'nope', 'summary', 'clarify', 'culprit', 'chat'];
const knownIds = () => new Set([...ACTIONS.map((a) => a.id), ...PERSONS.map((p) => `P:${p.id}`), ...NOPE.map((n) => n.id)]);

export function buildOrderPrompt(text: string, s: ColdState, history: { who: string; text: string }[]): string {
  const recent = history.slice(-6).map((m) => `${m.who === '나' ? '형사' : '반장'}: ${m.text.replace(/\s+/g, ' ').slice(0, 140)}`);
  const owned = s.have.filter((id) => evidenceById.has(id)).map((id) => evidenceById.get(id)!.title);
  return [
    '[조사 목록] (ID: 조사 / 이런 말로 시킨다)',
    ...ACTIONS.map((a) => `${a.id}: ${a.label} / 예: ${(ACTION_WORDS[a.id] ?? []).slice(0, 5).join(', ')}`),
    '',
    '[인물 목록] (ID: 이름, 관계 / 이렇게 부른다) — 만나기·소환·물어보기',
    ...PERSONS.map((p) => `P:${p.id}: ${p.name}, ${p.role} / 예: ${(PERSON_WORDS[p.id] ?? []).slice(0, 4).join(', ')}`),
    '',
    '[안 되는 조사] (ID: 이런 조사)',
    ...NOPE.map((n) => `${n.id}: ${n.topic}`),
    CACHE_BREAK,
    `[이미 확보한 자료] ${owned.join(', ') || '(없음)'}`,
    `[이미 한 조사] ${s.done.join(', ') || '(없음)'}`,
    CACHE_BREAK,
    '[최근 대화]',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_ORDER_INPUT)),
    '</형사의 말>',
  ].join('\n');
}

export function sanitizeOrder(raw: unknown): Omit<Order, 'via'> {
  const o = (raw ?? {}) as { kind?: unknown; ids?: unknown; reply?: unknown };
  const kind = KINDS.includes(o.kind as OrderKind) ? (o.kind as OrderKind) : 'clarify';
  const known = knownIds();
  const ids = [...new Set(Array.isArray(o.ids) ? o.ids.filter((x): x is string => typeof x === 'string' && known.has(x)) : [])];
  const reply = typeof o.reply === 'string' ? o.reply.trim().slice(0, 200) : '';
  if (ids.length) return { kind: ids.some((x) => !x.startsWith('N:')) ? 'order' : 'nope', ids, reply: '' };
  if (kind === 'order' || kind === 'nope') return { kind: 'clarify', ids: [], reply };
  return { kind, ids: [], reply: kind === 'clarify' || kind === 'chat' ? safeReply(reply) : '' };
}

/** 반장이 새 사실을 만들지 않게: 숫자·사람 이름이 들어간 말은 버린다 */
function safeReply(t: string): string {
  if (!t || /\d/.test(t)) return '';
  if (PERSONS.some((p) => t.includes(p.name))) return '';
  return t;
}

/** AI 없이 낱말로 고른다. 긴 표현부터 맞춰 보고, 겹치는 짧은 표현은 건너뛴다 */
export function wordOrder(text: string): Omit<Order, 'via'> {
  const t = text.toLowerCase();
  if (/정리|요약|뭘 하면|뭐 남았|남은 거/.test(t)) return { kind: 'summary', ids: [], reply: '' };
  if (/범인|누가 죽였|누가 범/.test(t)) return { kind: 'culprit', ids: [], reply: '' };
  const pairs: [string, string][] = [
    ...NOPE.flatMap((n) => n.words.map((w) => [w, n.id] as [string, string])),
    ...Object.entries(ACTION_WORDS).flatMap(([id, ws]) => ws.map((w) => [w, id] as [string, string])),
    ...Object.entries(PERSON_WORDS).flatMap(([id, ws]) => ws.map((w) => [w, `P:${id}`] as [string, string])),
  ].sort((a, b) => b[0].length - a[0].length);
  let rest = t;
  const hits: { id: string; at: number }[] = [];
  for (const [w, id] of pairs) {
    const at = rest.indexOf(w.toLowerCase());
    if (at < 0 || hits.some((h) => h.id === id)) continue;
    hits.push({ id, at });
    rest = rest.slice(0, at) + ' '.repeat(w.length) + rest.slice(at + w.length);
  }
  let ids = hits.sort((a, b) => a.at - b.at).map((h) => h.id);
  // "지아 휴대폰 위치 추적"처럼 안 되는 조사의 대상으로 나온 사람은 부르지 않는다
  if (ids.some((x) => x.startsWith('N:'))) ids = ids.filter((x) => !x.startsWith('P:'));
  if (!ids.length) return { kind: 'clarify', ids: [], reply: '무슨 말인지 모르겠다. 뭘 보자는 건지 하나만 콕 집어 줘.' };
  return { kind: ids.some((x) => !x.startsWith('N:')) ? 'order' : 'nope', ids, reply: '' };
}

