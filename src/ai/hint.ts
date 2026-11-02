import { CHALLENGES, PERSONS } from '../data/case';
import { plain } from '../data/clues';
import { WORLD } from '../data/dossiers';
import { investigationById } from '../data/investigations';
import type { PersonId } from '../data/types';
import { visibleClaims } from '../engine/claims';
import type { HintStep } from '../engine/hints';
import { evidenceById, nameOf } from '../engine/lookup';
import type { GameState } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { settledTalk } from './statement';
import { callAI } from './transport';

// 힌트 (2026-10-15). 버튼을 누를 때 AI가 지금 진행 상황(자료·진술서·대화·진행 중인 조사·앞서 준 힌트)을 읽고 다음 할 일 하나를 권한다.
// 무엇을 다음 목표로 삼을지는 엔진(engine/hints.ts의 nextHint)이 정한다. AI는 플레이어가 이미 한 일을 보고 그 목표를 향한 말을 짓는다.
// 그래서 "이미 물어 답을 들은 것을 다시 물어보라"는 힌트가 나오지 않고, 범인이나 아직 받지 않은 자료의 내용을 앞질러 말하지 않는다.

export interface AiHint { title: string; hint: string; detail: string }

const MAX_PER_PERSON = 30;
const cut = (t: string, n: number) => { const s = noBreak(plain(t)).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; };

export function buildHintPrompt(s: GameState, step: HintStep): string {
  const owned = new Set(s.owned);
  const people = Object.keys(PERSONS) as PersonId[];
  const docs = s.owned.filter((id) => evidenceById.has(id)).map((id) => `- 「${evidenceById.get(id)!.title}」: ${cut(evidenceById.get(id)!.summary, 220)}${s.unseen.includes(id) ? ' (아직 열어 보지 않음)' : ''}`);
  const statement = (p: PersonId) => {
    const ai = s.statements?.[p];
    if (ai?.sections.length) return ai.sections.flatMap((sec) => sec.lines.map((l) => `  - [${sec.title}] ${cut(l.text, 200)}${l.kind === 'revised' ? ` (정정. 앞서: ${cut(l.was ?? '', 120)})` : l.kind === 'fact' ? ' (인정한 사실)' : l.kind === 'added' ? ' (근거를 보고 털어놓음)' : ''}`));
    const claims = visibleClaims(p, owned);
    return claims.length ? claims.map((c) => `  - ${plain(c.text)}${c.struck ? ' (정정됨)' : ''}`) : ['  (아직 받은 진술 없음)'];
  };
  const talk = (p: PersonId) => {
    const lines = settledTalk(s.chats[p]).filter((m) => m.role !== 'note').slice(-MAX_PER_PERSON)
      .map((m) => `  ${m.role === 'me' ? '형사' : PERSONS[p].name}: ${cut(m.text, 200)}${m.attached?.length ? ` [내민 자료: ${m.attached.map(nameOf).join(', ')}]` : ''}`);
    return lines.length ? lines : ['  (아직 대화 없음)'];
  };
  const broken = CHALLENGES.filter((c) => s.done.includes(c.id)).map((c) => `- ${PERSONS[c.person].name}: ${c.note ? cut(c.note, 160) : '거짓말 하나를 무너뜨렸다'}`);
  const jobs = s.team.jobs.map((j) => `- ${investigationById.get(j.inv)?.label ?? j.label}`);
  const team = settledTalk(s.team.chat).slice(-10).map((m) => `  ${m.role === 'me' ? '수사관' : '수사팀'}: ${cut(m.text, 160)}`);
  const prev = (s.hintLog ?? []).slice(-4).map((h) => `- ${h.title}: ${cut(h.hint, 120)} / ${cut(h.detail, 160)}`);
  return [
    WORLD,
    '',
    '[인물]',
    ...people.map((p) => `- ${PERSONS[p].name}: ${PERSONS[p].tag}`),
    CACHE_BREAK,
    '[다음 목표] (게임이 정한 지금의 단계. 이 방향만 권한다)',
    `주제: ${step.title}`,
    `hint의 세기 (이보다 세게 말하지 않는다): ${step.levels[0].replace(/\n/g, ' ')}`,
    `detail의 세기 (이보다 세게 말하지 않는다): ${(step.levels[1] ?? step.levels[0]).replace(/\n/g, ' ')}`,
    ...(step.realize ? [`플레이어가 스스로 깨달아야 할 것 (절대 힌트에 쓰지 않는다. 이것을 깨닫게 할 관찰·자료·질문만 권한다): ${step.realize}`] : []),
    ...(step.forbid?.length ? [`쓰면 안 되는 낱말: ${step.forbid.join(', ')}`] : []),
    `이 단계에서 이미 힌트를 본 횟수: ${(s.hintLog ?? []).filter((h) => h.key === step.key).length}`,
    ...(step.next ? [
      '',
      '[그다음 목표] (플레이어가 [대화 기록]·[수사팀과의 최근 대화]에서 [다음 목표]의 깨달음을 이미 말했거나 짐작한 티를 냈으면, [다음 목표] 대신 이쪽으로 쓴다. title도 이 주제로)',
      `주제: ${step.next.title}`,
      `hint의 세기: ${step.next.levels[0].replace(/\n/g, ' ')}`,
      `detail의 세기: ${(step.next.levels[1] ?? step.next.levels[0]).replace(/\n/g, ' ')}`,
      ...(step.next.realize ? [`플레이어가 스스로 깨달아야 할 것 (절대 쓰지 않는다): ${step.next.realize}`] : []),
    ] : []),
    '',
    '[확보한 자료]',
    ...(docs.length ? docs : ['(없음)']),
    '',
    '[진행 중인 조사]',
    ...(jobs.length ? jobs : ['(없음)']),
    '',
    '[무너뜨린 거짓말]',
    ...(broken.length ? broken : ['(아직 없음)']),
    '',
    '[진술서] (사람별로 지금까지 받은 진술)',
    ...people.flatMap((p) => [`${PERSONS[p].name}`, ...statement(p)]),
    '',
    '[대화 기록] (사람별 최근 대화, 오래된 것부터)',
    ...people.flatMap((p) => [`${PERSONS[p].name}`, ...talk(p)]),
    '',
    '[수사팀과의 최근 대화]',
    ...(team.length ? team : ['  (없음)']),
    '',
    '[이전 힌트] (같은 말을 되풀이하지 않는다)',
    ...(prev.length ? prev : ['(없음)']),
  ].join('\n');
}

/** 힌트 검사: 내부 ID, 범인 단정, 아직 풀리지 않은 반전의 낱말, 너무 긴 말은 쓰지 않는다 */
export function safeHint(h: AiHint, forbid: string[] = []): AiHint | null {
  const bad = (t: string) => !t.trim() || t.length > 400 || t.includes('⟦') || /\b([A-C]-(Q|R|F)\d+|GT-[ER]\d+|X-L\d+)\b/.test(t) || /(범인은|범인이다|진범|죽인 사람은|살해한 사람은)/.test(t) || forbid.some((w) => t.includes(w));
  if (bad(h.hint) || bad(h.detail) || !h.title.trim() || h.title.length > 40) return null;
  return { title: h.title.trim(), hint: h.hint.trim(), detail: h.detail.trim() };
}

export async function aiHint(s: GameState, step: HintStep): Promise<AiHint> {
  const text = await callAI('hint', buildHintPrompt(s, step), {
    attemptMs: 30000, hedgeMs: 15000, budgetMs: 50000,
    parse: (t) => { const o = JSON.parse(t) as AiHint; if (typeof o.hint !== 'string' || typeof o.detail !== 'string') throw new Error('hint 없음'); return o; },
  });
  const o = JSON.parse(text) as Partial<AiHint>;
  const safe = safeHint({ title: String(o.title ?? ''), hint: String(o.hint ?? ''), detail: String(o.detail ?? '') }, step.forbid);
  if (!safe) throw new Error('힌트 검사 통과 못 함');
  return safe;
}
