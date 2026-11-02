// 에피소드 1 게임 한 판의 상태와 AI 호출 (게임과 같은 검사·재시도). episode-convo.ts·ai-playtest.ts가 같이 쓴다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED, PERSONS } from '../../src/data/case';
import { STATEMENT_FORMS } from '../../src/data/statementForms';
import { investigationById } from '../../src/data/investigations';
import type { PersonId } from '../../src/data/types';
import { runAi, type AiResult } from '../../server/aiHandler';
import { buildTalkPrompt, checkTalk, repairNote, safeTalk, talkIds, TALK_PLAN, type Judge, type TalkInput } from '../../src/ai/talk';
import { buildJudgePrompt, sanitizeVerdict } from '../../src/ai/talkJudge';
import { sourceId } from '../../src/engine/claims';
import { buildDeskPrompt, checkDeskReply, DESK_RETRY, heardLines, sanitizeDesk } from '../../src/ai/desk';
import { deflectionById } from '../../src/data/investigations';
import { buildStatementPrompt, mergeStatement, reconcileStatement, sanitizeStatement, settledTalk, statementBasis, statementMode } from '../../src/ai/statement';
import { expandRequest, planRequest } from '../../src/engine/investigation';
import { looksLikeInjection } from '../../src/ai/interpret';
import { TEAM_LINES } from '../../src/data/investigations';
import type { AiStatement, ChatMsg } from '../../src/engine/state';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5';
/** 검사에 걸린 답을 고칠 점과 함께 다시 받는다 (게임과 같다). REPAIR=0이면 예전처럼 같은 프롬프트를 다시 보낸다 (비교용) */
const REPAIR = process.env.REPAIR !== '0';
/** 대사 판정 AI를 쓴다 (게임 기본값). JUDGE=0이면 예전 낱말 검사만 쓴다 (비교용) */
export const JUDGE = process.env.JUDGE !== '0';
/** PLAN=1: 해석 → 대사 한 번에 (talkPlan, 엔진 [추궁 판정] 없음). ANTHROPIC_TASK_MODELS로 작업별 모델을 바꿀 수 있다 */
export const PLAN = process.env.PLAN === '1';
TALK_PLAN.on = PLAN;
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: MODEL, ANTHROPIC_TASK_MODELS: process.env.ANTHROPIC_TASK_MODELS };
const DIR = 'design/convo';
mkdirSync(`${DIR}/auto`, { recursive: true });

/** 100만 토큰당 달러 */
const PRICE: Record<string, { in: number; read: number; write: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, read: 0.01, write: 0.125, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, read: 0.2, write: 2.5, out: 10 },
};
const LEDGER = `${DIR}/ledger.json`;
const ledger = (): { usd: number; calls: number } => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { usd: 0, calls: 0 });
let runUsd = 0, runCalls = 0;
/** 작업별 비용·호출 수·시간 */
export const byTask: Record<string, { usd: number; calls: number; ms: number[] }> = {};
function charge(out: AiResult, task = 'talk') {
  const p = PRICE[out.model] ?? PRICE[MODEL] ?? PRICE['claude-sonnet-5-5'];
  const u = out.usage;
  const usd = u ? (u.input * p.in + u.cacheRead * p.read + u.cacheWrite * p.write + u.output * p.out) / 1e6 : 0;
  const l = ledger();
  writeFileSync(LEDGER, JSON.stringify({ usd: l.usd + usd, calls: l.calls + 1 }));
  runUsd += usd; runCalls++;
  const t = byTask[task] ??= { usd: 0, calls: 0, ms: [] };
  t.usd += usd; t.calls++; t.ms.push(out.ms);
}
async function call(task: 'talk' | 'talkPlan' | 'talkJudge' | 'desk' | 'statement', user: string) {
  for (let i = 0; ; i++) {
    try { const out = await runAi({ task, user }, env); charge(out, task); return out; } catch (e) { if (i >= 2) throw e; }
  }
}

export type Who = 'A' | 'B' | 'C';
export interface S { owned: Set<string>; chats: Record<Who, ChatMsg[]>; team: ChatMsg[]; statements: Partial<Record<PersonId, AiStatement>> }
export type TalkR = { reply: string; record: string[]; give: string[]; admit: string[]; rejects: string[]; fallback?: boolean };

const judgeViaServer: Judge = async (input, reply) => sanitizeVerdict(JSON.parse((await call('talkJudge', buildJudgePrompt(input, reply))).text), input.person, reply);
/** 모든 시도가 검사에 걸려 엔진 대사로 답한 턴 수 */
export const fallbackStats = { turns: 0, fallbacks: 0 };
export type DeskR = { reply: string; shown: string; start: string[]; deflect: string[]; got: string[]; fallback: boolean };

let k = 0;
const key = () => `m${(k++).toString(36)}`;

/** AI가 낸 ID 가운데 목록에 아예 없는 것(지어낸 ID)과 목록에는 있지만 지금 단계라 엔진이 거른 것 */
export const idStats = { talk: 0, invented: [] as string[], gated: [] as string[], desk: 0, deskInvented: [] as string[] };
function countIds(person: Who, raw: Record<string, unknown>, kept: Record<string, unknown>) {
  const all = talkIds(person);
  for (const f of ['record', 'give', 'admit', 'basis'] as const) {
    const ids = Array.isArray(raw[f]) ? (raw[f] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    const ok = new Set(kept[f] as string[]);
    for (const id of ids) {
      idStats.talk++;
      if (!all[f].includes(id) && !all[f].includes(sourceId(id))) idStats.invented.push(`${person}.${f}:${id}`);
      else if (!ok.has(id)) idStats.gated.push(`${person}.${f}:${id}`);
    }
  }
}

export async function sayPerson(s: S, person: Who, text: string, att?: string[]): Promise<TalkR> {
  // 게임처럼: 해석기를 조작하려는 말은 AI에 보내지 않는다 (conversation.ts)
  if (looksLikeInjection(text)) { s.chats[person].push({ id: key(), role: 'me', text }, { id: key(), role: 'them', text: '(조작 시도 차단: 되묻는 말)' }); return { reply: '(차단)', record: [], give: [], admit: [], basis: [], rejects: [] }; }
  const attached = att?.filter((id) => s.owned.has(id));
  const input: TalkInput = { person, text, owned: s.owned, history: s.chats[person], attached: attached?.length ? attached : undefined };
  const user = buildTalkPrompt(input);
  const rejects: string[] = [];
  // 게임(talk.ts의 talk)과 같은 검사. 걸리면 고칠 점을 붙여 다시 받는다 (게임처럼 최대 4번, 모두 걸리면 엔진 대사)
  let fix = '';
  fallbackStats.turns++;
  for (let i = 0; i <= 4; i++) {
    let r: Omit<TalkR, 'rejects'>;
    let raw: { reply: string } = { reply: '' };
    if (i === 4) { fallbackStats.fallbacks++; r = { ...safeTalk(input), fallback: true }; }
    else {
      const o = await call(PLAN ? 'talkPlan' : 'talk', user + (REPAIR ? fix : ''));
      raw = JSON.parse(o.text) as { reply: string };
      const { problem, result } = await checkTalk(input, raw, JUDGE ? judgeViaServer : null, (process.env.JUDGE_MODE as 'full' | 'hybrid') ?? 'hybrid');
      if (problem) { rejects.push(`${problem.why}: ${raw.reply}`); fix = repairNote(problem.fix); continue; }
      r = { ...result, ...(PLAN ? { presented: (raw as Record<string, unknown>).presented, breaks: (raw as Record<string, unknown>).breaks } : {}) } as typeof r;
      countIds(person, raw as unknown as Record<string, unknown>, result);
    }
    s.chats[person].push({ id: key(), role: 'me', text, ...(input.attached ? { attached: input.attached } : {}) }, { id: key(), role: 'them', text: r.reply, kind: r.admit.length ? 'success' : r.record.length ? 'fact' : 'written', facts: r.record });
    const base = STATEMENT_FORMS[person].statementId;
    for (const id of [...r.record, ...r.give, ...r.admit, ...((r.record.length || r.admit.length) ? [base] : [])]) s.owned.add(id);
    return { ...r, rejects };
  }
  throw new Error('도달하지 않음');
}

export async function sayTeam(s: S, text: string): Promise<DeskR> {
  if (looksLikeInjection(text)) { s.team.push({ id: key(), role: 'me', text }, { id: key(), role: 'them', text: TEAM_LINES.unclear }); return { reply: TEAM_LINES.unclear, shown: TEAM_LINES.unclear, start: [], deflect: [], got: [], fallback: false }; }
  const heard = heardLines(s.statements, s.owned);
  const input = { text, owned: s.owned, history: s.team, jobs: [], heard };
  const recent = s.team.slice(-14).map((m) => m.text).join(' ');
  const check = (r: ReturnType<typeof sanitizeDesk>) => checkDeskReply(r.reply, { owned: s.owned, said: text, recent, heard, deflect: r.deflect });
  const rawDesk = JSON.parse((await call('desk', buildDeskPrompt(input))).text) as Record<string, unknown>;
  let r = sanitizeDesk(rawDesk);
  for (const f of ['start', 'deflect'] as const) for (const id of (Array.isArray(rawDesk[f]) ? rawDesk[f] as string[] : [])) { idStats.desk++; if (!(r[f] as string[]).includes(id)) idStats.deskInvented.push(`${f}:${id}`); }
  if (!r.start.length && !r.deflect.length && !check(r)) r = sanitizeDesk(JSON.parse((await call('desk', buildDeskPrompt({ ...input, retry: DESK_RETRY }))).text));
  // 게임처럼: 조사를 맡으면 엔진의 접수 문구를 보인다 (teamChat.applyDesk)
  const plan = r.start.length ? planRequest(r.start, s.owned, []) : null;
  const notes = r.deflect.map((id) => deflectionById.get(id)?.line).filter(Boolean).join('\n');
  const safe = check(r) ?? (notes || null);
  const shown = plan && plan.status !== 'none' ? [plan.text, notes].filter(Boolean).join('\n') : safe ?? '(대체 문구)';
  s.team.push({ id: key(), role: 'me', text }, { id: key(), role: 'them', text: shown });
  // 맡은 조사는 바로 도착한 것으로 친다
  // 게임처럼 맡은 조사만 도착한다 (한도에 걸려 맡지 않은 조사의 결과는 넣지 않는다)
  const started = plan?.status === 'started' ? plan.jobs.map((j) => j.inv) : [];
  const got = started.flatMap((id) => [...investigationById.get(id)!.outputs, ...(investigationById.get(id)!.bonus ?? [])]);
  for (const id of got) s.owned.add(id);
  return { reply: r.reply, shown, start: r.start, deflect: r.deflect, got, fallback: !(plan && plan.status !== 'none') && !safe };
}

export async function statement(s: S, person: Who): Promise<AiStatement> {
  const prev = s.statements[person];
  const input = { person, owned: s.owned, chat: s.chats[person], prev };
  const mode = statementMode(input);
  const o = await call('statement', buildStatementPrompt({ ...input, mode }));
  const upto = settledTalk(input.chat).length;
  const st = reconcileStatement(mode === 'delta' && prev ? mergeStatement(prev, JSON.parse(o.text), person, s.owned, upto) : sanitizeStatement(JSON.parse(o.text), person, s.owned, upto), person, s.owned, settledTalk(s.chats[person]));
  s.statements[person] = { ...st, basis: statementBasis(person, s.owned) };
  return st;
}

export const newSession = (owned: string[] = []): S => ({ owned: new Set([...INITIAL_OWNED, ...owned]), chats: { A: [], B: [], C: [] }, team: [], statements: {} });
export const runCost = () => ({ usd: runUsd, calls: runCalls });
export { ledger, DIR, call };