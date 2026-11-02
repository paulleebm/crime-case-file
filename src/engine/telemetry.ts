import { appCheckToken, aiListeners } from '../ai/transport';
import type { PersonId } from '../data/types';
import type { Action, ChatMsg, GameState } from './state';

// 플레이 기록. AI 대화가 자연스러운지, 플레이어가 어디서 헤매고 어떻게 풀었는지 보려고 서버 로그(/api/log)로 보낸다.
//  - 기기 ID(uid)와 한 판의 ID(run)는 무작위 값이다. 이름·접속 주소 같은 개인 정보는 보내지 않는다.
//  - 동작마다 사건을 모았다가 몇 초에 한 번, 그리고 창을 닫거나 숨길 때 묶어서 보낸다. 보내지 못하면 버린다 (게임을 막지 않는다).
//  - 이 기능 전에 한 대화는 브라우저 저장본에만 있다. 저장본을 이어 할 때 그 판의 대화를 한 번 올린다(backfill).

// 에피소드 이름 (서버 요약이 판을 에피소드별로 나눈다)
const EP = 'gold-trophy';
const UID_KEY = 'bellua-log-uid';
const RUN_KEY = 'bellua-log-run';
const BACKFILL_KEY = 'bellua-log-backfilled';
const FLUSH_MS = 4000;
const MAX_BATCH = 40;
/** 한 묶음 본문 상한 (창을 닫을 때 keepalive 요청은 64KB까지만 보낼 수 있다) */
const MAX_BODY = 60_000;
const isDev = !!import.meta.env?.DEV;

type Ev = { type: string; at: number } & Record<string, unknown>;

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
function stored(key: string, make: () => string): string {
  try {
    const v = localStorage.getItem(key);
    if (v) return v;
    const n = make();
    localStorage.setItem(key, n);
    return n;
  } catch { return make(); }
}

const uid = typeof window !== 'undefined' ? stored(UID_KEY, rid) : 'node';
let run = typeof window !== 'undefined' ? stored(RUN_KEY, rid) : 'node';
/** 이 페이지를 연 뒤 처음 시각, 마지막으로 진전(새 자료·지적 성공)이 있었던 시각 */
let progressAt = Date.now();
let queue: Ev[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function track(type: string, data: Record<string, unknown> = {}) {
  if (typeof window === 'undefined') return;
  const at = Date.now();
  queue.push({ type, at, ep: EP, idle: Math.round((at - progressAt) / 1000), ...data });
  if (queue.length >= MAX_BATCH) void flush();
  else if (!timer) timer = setTimeout(() => void flush(), FLUSH_MS);
}

/** 쌓인 사건을 보낸다. 본문이 크면 여러 번에 나눈다 */
async function flush(closing = false) {
  if (timer) { clearTimeout(timer); timer = null; }
  while (queue.length) {
    let n = Math.min(queue.length, MAX_BATCH);
    let body = JSON.stringify({ uid, run, events: queue.slice(0, n) });
    while (body.length > MAX_BODY && n > 1) { n = Math.ceil(n / 2); body = JSON.stringify({ uid, run, events: queue.slice(0, n) }); }
    queue = queue.slice(n);
    if (body.length > MAX_BODY) continue; // 한 사건이 너무 크면 버린다 (backfill은 미리 잘게 나눈다)
    await send(body, closing);
  }
}

async function send(body: string, closing: boolean): Promise<boolean> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isDev) {
      // 창을 닫는 중에는 토큰을 새로 받을 시간이 없다. 받아 둔 토큰이 없으면 보내지 못한다
      const token = closing ? lastToken : await appCheckToken();
      if (token) { lastToken = token; headers['X-Firebase-AppCheck'] = token; }
    }
    const r = await fetch('/api/log', { method: 'POST', headers, body, keepalive: closing });
    return r.ok;
  } catch {
    return false;
  }
}
let lastToken: string | null = null;

if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flush(true); });
  window.addEventListener('pagehide', () => void flush(true));
  // AI 요청 하나하나의 결과 (어느 작업이 느리거나 실패하는지)
  aiListeners.push((s) => track('ai', { task: s.task, route: s.route, ok: s.ok, ms: s.ms, ...(s.error ? { error: s.error } : {}), ...(s.model ? { model: s.model } : {}), ...(s.usage ? { usage: s.usage } : {}) }));
}

const chatFields = (m: ChatMsg) => ({
  id: m.id, role: m.role, text: m.text,
  ...(m.kind ? { outcome: m.kind } : {}), ...(m.facts?.length ? { facts: m.facts } : {}),
  ...(m.record ? { record: m.record } : {}), ...(m.hint ? { hint: true } : {}), ...(m.sub ? { sub: m.sub } : {}),
  ...(m.status ? { status: m.status } : {}), ...(m.error ? { error: m.error } : {}),
});

/** 이 기능 전에 한 대화를 한 번 올린다. 사람별로, 큰 대화는 잘게 나눈다 */
function backfill(s: GameState) {
  try { if (localStorage.getItem(BACKFILL_KEY) === run) return; localStorage.setItem(BACKFILL_KEY, run); } catch { return; }
  for (const [person, msgs] of Object.entries(s.chats) as [PersonId, ChatMsg[]][]) {
    if (msgs.length <= 1) continue; // 첫인사뿐
    for (let i = 0; i < msgs.length; i += 25) {
      track('backfill', { person, from: i, total: msgs.length, msgs: msgs.slice(i, i + 25).map(chatFields) });
    }
  }
  track('backfill_state', { owned: s.owned, done: s.done, hints: s.hints?.uses ?? 0, result: s.result?.grade ?? null });
}

/** 판을 열었다: 새 게임이면 새 판 ID를 쓰고, 이어 하기면 그 판의 예전 대화를 올린다 */
function opened(blank: GameState, after: GameState) {
  const fresh = after.owned.length === blank.owned.length && Object.values(after.chats).every((m) => m.length <= 1) && !after.result;
  // 새 판은 처음부터 기록하므로 올릴 예전 대화가 없다
  if (fresh) { run = rid(); try { localStorage.setItem(RUN_KEY, run); localStorage.setItem(BACKFILL_KEY, run); } catch { /* noop */ } }
  progressAt = Date.now();
  track(fresh ? 'start' : 'resume', { screen: after.screen, owned: after.owned.length, done: after.done.length, ua: navigator.userAgent.slice(0, 120) });
  if (!fresh) backfill(after);
}

/** 동작 하나를 기록할 사건으로 바꾼다. 상태(before→after)를 보고 실제로 바뀐 것만 남긴다 */
export function observe(a: Action, before: GameState, after: GameState) {
  switch (a.type) {
    case 'load': opened(before, after); return;
    // 표지·사건 고르기는 판이 정해지기 전이라 남기지 않는다
    case 'screen': if (a.screen !== before.screen && a.screen !== 'episodes' && a.screen !== 'title') track('screen', { screen: a.screen }); return;
    case 'openTab': track('open', { tab: a.tab.type, ...(a.tab.ref ? { ref: a.tab.ref } : {}) }); return;
    case 'chat': track('chat', { person: a.person, ...chatFields(a.msg) }); return;
    case 'teamChat': track('chat', { person: 'team', ...chatFields(a.msg) }); return;
    case 'teamStart': track('team_start', { jobs: a.jobs.map((j) => j.inv) }); return;
    case 'teamDeliver': track('team_result', { job: a.jobId, docs: before.team.jobs.find((j) => j.id === a.jobId)?.outputs ?? [] }); return;
    case 'chatPatch':
      if (a.patch.status === 'failed') track('chat_fail', { person: a.person, id: a.id, error: a.patch.error });
      else if (a.patch.status === 'pending') track('chat_retry', { person: a.person, id: a.id });
      return;
    case 'reveal': {
      const ids = after.owned.filter((id) => !before.owned.includes(id));
      if (!ids.length) return;
      track('reveal', { ids, ...(a.toast ? { toast: a.toast } : {}), owned: after.owned.length });
      progressAt = Date.now();
      return;
    }
    case 'done':
      if (before.done.includes(a.id)) return;
      track('solve', { id: a.id, done: after.done.length });
      progressAt = Date.now();
      return;
    case 'hint': track('hint', { key: a.key, level: after.hints?.seen[a.key] ?? 1, uses: after.hints?.uses ?? 1 }); return;
    case 'press': track('press', { add: a.add }); return;
    case 'pawnPlace': track('map', { who: a.who, t: a.t }); return;
    case 'report': track('report', { patch: a.patch }); return;
    case 'result': track('result', { ...a.result, owned: after.owned.length, done: after.done.length, hints: after.hints?.uses ?? 0 }); void flush(); return;
  }
}
