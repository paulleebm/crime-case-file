import { PERSONS, STATEMENTS } from '../data/case';
import { plain } from '../data/clues';
import type { PersonId } from '../data/types';
import { evidenceById, factById, nameOf, statementById } from './lookup';
import type { ChatMsg } from './state';

// 용의자별 상황 메모. AI에게 최근 대화 6개와 함께 넘긴다.
// 대화가 길어져도 "지금까지 정해진 것"을 잊지 않게 한다. 게임 상태에서 만들므로 요약이 틀리지 않는다.
// 아직 드러나지 않은 진실은 넣지 않는다 (인물이 인정한 것과 이미 한 말만).

/** 저장해 두는 부분: AI가 직접 쓴 답, 형사가 이 인물에게 보여 준 근거 */
export interface Memo {
  written: { q: string; a: string; casual?: boolean }[];
  shown: string[];
}

export const emptyMemo = (): Memo => ({ written: [], shown: [] });

const MAX_SAID = 15;
const MAX_WRITTEN = 10;
const cut = (t: string, n: number) => { const s = plain(t).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

/** 이 인물이 대화에서 답한 주제 (먼저 한 것부터) */
function answeredFacts(chats: ChatMsg[]): string[] {
  const out: string[] = [];
  for (const m of chats) if (m.role === 'them') for (const id of m.facts ?? []) if (!out.includes(id)) out.push(id);
  return out;
}

export function buildMemo(person: PersonId, owned: Set<string>, chats: ChatMsg[], memo: Memo | undefined): string {
  const lines: string[] = [];
  // 1. 진행도: 정정·추가 진술로 인정한 것
  const admitted = STATEMENTS.filter((s) => s.person === person && !s.initial && owned.has(s.id));
  lines.push('· 인정한 것: ' + (admitted.length ? admitted.map((s) => `“${cut(s.text.replace(/^…/, ''), 60)}”`).join(' / ') : '아직 처음 진술에서 바꾼 것이 없다'));
  // 2. 이미 한 말 (준비된 답)
  const said = answeredFacts(chats).filter((id) => factById.get(id)?.person === person).slice(-MAX_SAID);
  if (said.length) lines.push('· 이미 한 말: ' + said.map((id) => `[${cut(factById.get(id)!.topic, 24)}] ${cut(factById.get(id)!.answer, 45)}`).join(' | '));
  // 3. 직접 쓴 답 (이 말과 어긋나면 안 된다)
  const written = (memo?.written ?? []).slice(-MAX_WRITTEN);
  if (written.length) lines.push('· 직접 한 말(앞뒤가 맞아야 함): ' + written.map((w) => `“${cut(w.q, 30)}” → “${cut(w.a, 60)}”`).join(' | '));
  // 4. 최근 화제: 마지막으로 다룬 주제
  const lastThem = [...chats].reverse().find((m) => m.role === 'them' && (m.facts?.length || m.kind === 'written'));
  const topic = lastThem?.facts?.length ? lastThem.facts.map((id) => factById.get(id)?.topic).filter(Boolean).join(', ') : written.length ? written[written.length - 1].q : '';
  if (topic) lines.push(`· 최근 화제: ${cut(topic, 60)}`);
  // 5. 형사가 이 인물에게 보여 준 근거
  const shown = (memo?.shown ?? []).filter((id) => evidenceById.has(id) || statementById.has(id) || factById.has(id));
  if (shown.length) lines.push('· 형사가 보여 준 근거: ' + [...new Set(shown.map(nameOf))].join(', '));
  return `${PERSONS[person].name}\n${lines.join('\n')}`;
}
