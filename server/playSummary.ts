import { usdOf } from '../src/ai/pricing';
import { isTask } from '../src/ai/prompts';

// 플레이 기록 목록 요약. /api/logs 가 Cloud Logging에서 읽은 사건을 판 하나당 한 줄로 줄여 돌려준다
// (배포 함수 functions/src/index.ts 와 개발 서버 dev/aiProxy.ts 가 함께 쓴다).
//  - 판 = 기기(uid) + 판 ID(run) + 에피소드(ep). 지금 에피소드(MAIN_EP) 판만 요약한다.
//    ep가 없는 예전 사건은 AI 작업 이름으로 가린다: 지금 없는 작업만 쓴 판은 없어진 에피소드 판이라 뺀다.
//  - 「새 게임 시작」 없이 시작된 판은 같은 기기·같은 에피소드의 바로 앞 판에 이어 붙인다 (이어서 한 플레이).
//  - 플레이 시간은 사건 사이 간격을 더하되 BREAK_MS보다 길게 빈 구간은 쉰 것으로 보고 뺀다.

type Ev = Record<string, any>;

/** 목록에 필요한 사건만 읽는다 (대화 본문은 판을 펼쳐 대화를 누를 때 읽는다) */
export const SUMMARY_TYPES = ['start', 'resume', 'result', 'ai', 'hint', 'solve', 'backfill_state', 'screen', 'open', 'team_start'];
/** 한 판의 진행 흐름에 쓰는 사건 (대화 제외) */
export const FLOW_TYPES = ['start', 'resume', 'backfill_state', 'reveal', 'solve', 'hint', 'team_start', 'team_result', 'chat_fail', 'report', 'result', 'screen', 'open', 'ai'];
export const CHAT_TYPES = ['chat', 'backfill'];

const BREAK_MS = 10 * 60_000;
export const MAIN_EP = 'gold-trophy';

export interface AiSum { calls: number; fails: number; usd: number; unpriced: number; tokens: number; byTask: Record<string, { calls: number; usd: number }>; models: Record<string, number> }

export interface RunRow {
  /** 대표 판 ID (가장 먼저 시작한 판) */
  id: string;
  /** 합친 판 ID들 */
  runs: string[];
  uid: string; ip: string | null; ep: string;
  first: number; last: number;
  /** 쉰 시간을 뺀 플레이 시간 */
  activeMs: number;
  /** 접속 횟수 (BREAK_MS 넘게 비면 새 접속) */
  sessions: number;
  fresh: boolean;
  grade: string | null; done: number; hints: number; questions: number; screen: string; ua?: string;
  ai: AiSum;
}

const ms = (at: unknown) => +new Date(at as string | number);
/** 본편에서만 쓰는 AI 작업 (statement·grade 등은 없어진 에피소드도 같은 이름으로 썼다) */
const MAIN_ONLY_TASKS = new Set(['talk', 'desk', 'interpret', 'team', 'voice']);

export function summarizeRuns(all: Ev[]): RunRow[] {
  // 1) 예전 사건(ep 없음)의 에피소드를 판 단위로 가리고, 지금 에피소드 사건만 남긴다
  const legacyGone = new Set<string>();
  const legacyMain = new Set<string>();
  for (const e of all) {
    if (e.ep || e.type !== 'ai') continue;
    if (!isTask(e.task)) legacyGone.add(e.run);
    else if (MAIN_ONLY_TASKS.has(e.task)) legacyMain.add(e.run);
  }
  const epOf = (e: Ev): string | null => e.ep ?? (legacyGone.has(e.run) && !legacyMain.has(e.run) ? null : MAIN_EP);
  const events = all.filter((e) => epOf(e) === MAIN_EP);

  // 2) 판별 시작 시각과 「새 게임 시작」 여부
  type Seg = { key: string; uid: string; ep: string; first: number; fresh: boolean };
  const seg = new Map<string, Seg>();
  for (const e of events) {
    const ep = MAIN_EP;
    const key = `${e.run}|${ep}`;
    const t = ms(e.at);
    const s = seg.get(key);
    if (!s) seg.set(key, { key, uid: e.uid, ep, first: t, fresh: e.type === 'start' });
    else { s.first = Math.min(s.first, t); if (e.type === 'start') s.fresh = true; }
  }

  // 3) 새 게임 시작이 없는 판은 같은 기기·같은 에피소드의 바로 앞 판에 붙인다
  const canon = new Map<string, string>();
  const byOwner = new Map<string, Seg[]>();
  for (const s of seg.values()) {
    const k = `${s.uid}|${s.ep}`;
    let xs = byOwner.get(k);
    if (!xs) byOwner.set(k, (xs = []));
    xs.push(s);
  }
  for (const xs of byOwner.values()) {
    xs.sort((a, b) => a.first - b.first);
    let head: string | null = null;
    for (const s of xs) {
      if (s.fresh || !head) head = s.key;
      canon.set(s.key, head);
    }
  }

  // 4) 합친 판마다 모은다
  const rows = new Map<string, RunRow & { times: number[] }>();
  for (const e of events) {
    const ep = MAIN_EP;
    const key = canon.get(`${e.run}|${ep}`)!;
    const t = ms(e.at);
    let r = rows.get(key);
    if (!r) {
      r = {
        id: key.split('|')[0], runs: [], uid: e.uid, ip: null, ep, first: t, last: t, activeMs: 0, sessions: 0, fresh: false,
        grade: null, done: 0, hints: 0, questions: 0, screen: '', times: [],
        ai: { calls: 0, fails: 0, usd: 0, unpriced: 0, tokens: 0, byTask: {}, models: {} },
      };
      rows.set(key, r);
    }
    if (!r.runs.includes(e.run)) r.runs.push(e.run);
    r.first = Math.min(r.first, t);
    r.last = Math.max(r.last, t);
    r.times.push(t);
    if (e.ip) r.ip = e.ip;
    switch (e.type) {
      case 'start': r.fresh = true; r.ua = e.ua; break;
      case 'resume': r.ua ??= e.ua; r.done = Math.max(r.done, e.done ?? 0); break;
      case 'backfill_state': r.done = Math.max(r.done, e.done?.length ?? 0); r.hints = Math.max(r.hints, e.hints ?? 0); break;
      case 'solve': r.done = Math.max(r.done, e.done ?? 0); break;
      case 'hint': r.hints = Math.max(r.hints, e.uses ?? r.hints + 1); break;
      case 'result': r.grade = e.grade ?? null; r.done = Math.max(r.done, e.done ?? 0); r.hints = Math.max(r.hints, e.hints ?? 0); break;
      case 'screen': r.screen = e.screen; break;
      case 'ai': {
        const a = r.ai;
        a.calls++;
        if (!e.ok) a.fails++;
        const task = String(e.task ?? '?');
        const bt = (a.byTask[task] ??= { calls: 0, usd: 0 });
        bt.calls++;
        if (e.ok && e.task === 'talk') r.questions++;
        if (!e.usage) break;
        a.tokens += (e.usage.input ?? 0) + (e.usage.output ?? 0) + (e.usage.cacheRead ?? 0) + (e.usage.cacheWrite ?? 0);
        const model = e.model ?? '모델 미기록';
        a.models[model] = (a.models[model] ?? 0) + 1;
        const usd = usdOf(e.model, e.usage);
        if (usd === null) { a.unpriced++; break; }
        a.usd += usd;
        bt.usd += usd;
        break;
      }
    }
  }

  const out: RunRow[] = [];
  for (const { times, ...r } of rows.values()) {
    times.sort((a, b) => a - b);
    let active = 0, sessions = 1;
    for (let i = 1; i < times.length; i++) {
      const gap = times[i] - times[i - 1];
      if (gap > BREAK_MS) sessions++;
      else active += gap;
    }
    r.activeMs = active;
    r.sessions = sessions;
    out.push(r);
  }
  return out.sort((a, b) => b.last - a.last);
}
