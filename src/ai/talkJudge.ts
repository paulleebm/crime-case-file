import { PERSONS } from '../data/case';
import { plain } from '../data/clues';
import { DOSSIERS } from '../data/dossiers';
import type { PersonId } from '../data/types';
import { evidenceById, nameOf } from '../engine/lookup';
import type { ChatMsg } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { TALK_RULES } from '../data/talkRules';
export type { HiddenFact } from './talkRules';

// 대사 판정 (2026-10-20). 인물이 쓴 답을 다른 AI 요청이 읽고, 숨긴 사실 항목마다 시인·부정·언급했는지와 형사가 먼저 꺼냈는지만 표시한다.
// 누설인지, 인정으로 받아들일지는 엔진이 정한다 (talk.ts의 verdictProblem).
// 낱말 검사는 말투가 조금만 바뀌어도 놓치거나(2026-10-19 "트로피로 친 건 맞습니다") 잘못 막았다("화장실까지 옮겼지"를 되받은 말).
// "누설인지 판단하라"고 통째로 맡기면 Haiku가 cover 그대로인 말과 형사 말을 되받은 부인까지 누설로 잡았다 (2026-10-20 장면 점검). 그래서 항목을 쪼갰다.

export interface JudgeItem { stage: string; quote: string }
export interface JudgeVerdict { leaks: JudgeItem[]; concedes: JudgeItem[]; reasserts: JudgeItem[] }

export interface JudgeInput {
  person: PersonId;
  text: string;
  owned: Set<string>;
  history: ChatMsg[];
  attached?: string[];
}

/** 이 인물의 답을 판정할 일이 있는가: 숨긴 사실 항목이 있고 아직 인정하지 않은 단계가 남은 인물만 */
export const needsJudge = (person: PersonId, owned: Set<string>) => !!TALK_RULES.hiddenFacts[person] && DOSSIERS[person].stages.some((s) => !owned.has(s.id));

/** 칸 셋: 항목 목록(인물마다 고정) / 거둔 거짓말·형사가 가진 자료 / 대화·답 */
export function buildJudgePrompt({ person, text, owned, history, attached = [] }: JudgeInput, reply: string): string {
  const name = PERSONS[person].name;
  const part1 = [
    `[용의자] ${name}`,
    '',
    '[숨긴 사실] (id: 내용)',
    ...(TALK_RULES.hiddenFacts[person] ?? []).map((f) => `- ${f.id}: ${f.text}`),
  ].join('\n');
  const retracted = DOSSIERS[person].stages.filter((s) => owned.has(s.id)).flatMap((s) => TALK_RULES.retractedClaims[s.id] ?? []);
  const docs = [...owned].filter((id) => evidenceById.has(id));
  const part2 = [
    '[거둔 거짓말] (id: 이미 거짓이라고 인정한 말)',
    ...(retracted.length ? retracted.map((r) => `- ${r.id}: ${r.text}`) : ['(없음)']),
    '',
    '[형사가 가진 자료] (여기 적힌 사실은 형사가 이미 안다)',
    ...(docs.length ? docs.map((id) => `- ${evidenceById.get(id)!.title}: ${evidenceById.get(id)!.summary.trim()}`) : ['(없음)']),
  ].join('\n');
  const recent = history.filter((m) => !m.status && m.role !== 'note').slice(-12)
    .map((m) => `${m.role === 'me' ? '형사' : name}: ${plain(m.text).replace(/\s+/g, ' ')}${m.attached?.length ? ` [내민 자료: ${m.attached.map(nameOf).join(', ')}]` : ''}`);
  const part3 = [
    '[최근 대화] (오래된 것부터)',
    ...(recent.length ? recent : ['(없음)']),
    '',
    `[이번에 형사가 내민 자료] ${attached.length ? attached.map(nameOf).join(', ') : '(없음)'}`,
    '<형사의 말>',
    noBreak(text),
    '</형사의 말>',
    '',
    '<답>',
    noBreak(reply),
    '</답>',
  ].join('\n');
  return [part1, part2, part3].join(CACHE_BREAK);
}

/**
 * 항목 표시를 엔진의 판정으로 바꾼다.
 * 시인(admits) → 그 단계를 거둔 것. 형사가 꺼내지 않은 항목을 부정·언급 → 누설 (부정이 곧 cover인 항목은 부정해도 누설이 아니다).
 */
export function sanitizeVerdict(raw: unknown, person: PersonId, reply = ''): JudgeVerdict {
  const facts = new Map((TALK_RULES.hiddenFacts[person] ?? []).map((f) => [f.id, f]));
  const retracted = new Map(Object.entries(TALK_RULES.retractedClaims).flatMap(([stage, list]) => list.map((r) => [r.id, stage] as const)));
  const o = (raw ?? {}) as { facts?: unknown; reasserts?: unknown };
  const flat = (t: string) => t.replace(/\s+/g, '').replace(/[.…?!]+$/, '');
  // 답에 없는 구절을 짚은 표시는 버린다 (형사의 말을 옮겨 적는 일이 있었다)
  const inReply = (q: string) => !reply || (!!q && flat(reply).includes(flat(q)));
  const items = (Array.isArray(o.facts) ? o.facts : []) as { id?: unknown; said?: unknown; raised?: unknown; quote?: unknown }[];
  const out: JudgeVerdict = { leaks: [], concedes: [], reasserts: [] };
  for (const x of items) {
    const f = typeof x?.id === 'string' ? facts.get(x.id) : undefined;
    const quote = typeof x.quote === 'string' ? x.quote : '';
    if (!f || !inReply(quote)) continue;
    if (x.said === 'admits') out.concedes.push({ stage: f.stage, quote });
    else if (!x.raised && !(x.said === 'denies' && f.denyIsCover)) out.leaks.push({ stage: f.stage, quote });
  }
  for (const x of (Array.isArray(o.reasserts) ? o.reasserts : []) as { id?: unknown; quote?: unknown }[]) {
    const stage = typeof x?.id === 'string' ? retracted.get(x.id) : undefined;
    const quote = typeof x?.quote === 'string' ? x.quote : '';
    if (stage && inReply(quote)) out.reasserts.push({ stage, quote });
  }
  return out;
}
