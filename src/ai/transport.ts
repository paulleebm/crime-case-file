import { appCheckSiteKey, firebaseConfig } from '../firebaseConfig';
import { joinParts, TASKS, type AiTask } from './prompts';
import { authHeader } from '../account/account';
import { usdOf } from './pricing';

// AI 요청을 안정적으로 보내는 층. 대화가 서버 한 곳의 지연·장애로 멈추지 않게 한다.
//  - 경로 두 개: ① 프록시 함수(/api/ai: 서버 server/aiHandler.ts가 Claude → OpenAI → Vertex → Gemini 순으로 부른다), ② Firebase AI Logic(Vertex AI Gemini, 브라우저에서 직접)
//    프록시가 Claude를 쓰면 프록시만 쓴다(모든 작업을 같은 모델로). Claude가 없을 때만(키 없는 로컬 개발 등) Gemini 경로를 쓴다.
//  - 느린 응답도 기다린다: 시도 하나에 25초까지, 전체로는 1분까지.
//  - 시도마다 시간 상한을 두고, 늦으면 다른 경로로 한 번 더 보낸다(헤지). 먼저 온 올바른 답을 쓰고 나머지는 취소한다.
//  - 실패하면 잠깐 쉬었다 다른 경로로 다시 보낸다. 전체 대기 시간 상한 안에서만 한다.
//  - 깨진 JSON도 실패로 본다.
// 요청 결과(경로, 걸린 시간, 실패 이유)는 기록해 두고 콘솔에서 aiStats()로 볼 수 있다.

/** vite.config의 define으로 개발 서버에서만 채워진다 */
declare const __APPCHECK_DEBUG_TOKEN__: string;

type Route = 'proxy' | 'firebase';

export interface CallOptions {
  /** 시도 하나의 시간 상한 */
  attemptMs?: number;
  /** 이 시간 안에 답이 없으면 다른 경로로 하나 더 보낸다 */
  hedgeMs?: number;
  /** 전체 대기 시간 상한 */
  budgetMs?: number;
  /** 답을 읽어 확인한다. 예외를 던지면 그 답은 실패로 보고 다시 시도한다 (Rejected면 고칠 점을 붙여 다시 보낸다) */
  parse?: (text: string) => unknown | Promise<unknown>;
}

export interface AiUsage { input: number; output: number; cacheRead: number; cacheWrite: number }
export interface AiStat { task: AiTask; route: Route; ok: boolean; ms: number; error?: string; at: number; model?: string; usage?: AiUsage }

const STATS: AiStat[] = [];
/** 요청 결과를 받아 보는 곳 (플레이 기록) */
export const aiListeners: ((s: AiStat) => void)[] = [];
function record(s: AiStat) {
  STATS.push(s);
  if (STATS.length > 300) STATS.shift();
  for (const f of aiListeners) f(s);
}

/** 콘솔·플레이 테스트용: 경로별 성공률과 대기 시간, 모델별 비용 */
export function aiStats() {
  const by = (r?: Route) => {
    const xs = STATS.filter((s) => !r || s.route === r);
    const ok = xs.filter((s) => s.ok).map((s) => s.ms).sort((a, b) => a - b);
    const q = (p: number) => (ok.length ? ok[Math.min(ok.length - 1, Math.floor(p * ok.length))] : null);
    return { attempts: xs.length, failures: xs.length - ok.length, p50: q(0.5), p90: q(0.9), max: ok[ok.length - 1] ?? null };
  };
  // 응답한 모델의 단가로 센다. 단가를 모르는 모델은 토큰만 더하고 unpriced에 남긴다
  const u = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel: Record<string, { calls: number; costUsd: number }> = {};
  let usd = 0, unpriced = 0;
  for (const x of STATS) {
    if (!x.usage) continue;
    u.input += x.usage.input; u.output += x.usage.output; u.cacheRead += x.usage.cacheRead; u.cacheWrite += x.usage.cacheWrite;
    const priced = usdOf(x.model, x.usage);
    const c = priced ?? 0;
    if (priced === null) unpriced++;
    usd += c;
    const m = (byModel[x.model ?? '?'] ??= { calls: 0, costUsd: 0 });
    m.calls++; m.costUsd += c;
  }
  for (const m of Object.values(byModel)) m.costUsd = Math.round(m.costUsd * 10000) / 10000;
  return { all: by(), proxy: by('proxy'), firebase: by('firebase'), tokens: u, costUsd: Math.round(usd * 10000) / 10000, byModel, unpriced, recent: STATS.slice(-20) };
}
if (typeof window !== 'undefined') (window as unknown as { aiStats: typeof aiStats }).aiStats = aiStats;

// ─────────────── 경로 ① 유료 API 프록시 ───────────────

/** 프록시 상태. 페이지를 열 때 뒤에서 한 번 확인한다 (첫 질문을 늦추지 않는다). 모르면 쓰지 않는다 */
let proxy: { on: boolean; first: boolean; claude: boolean } = { on: false, first: false, claude: false };
/** 프록시 상태 확인이 끝나면 풀린다 (첫 질문이 확인 전에 다른 경로로 가지 않게 기다린다) */
let proxyChecked: Promise<void> = Promise.resolve();
const isDev = !!import.meta.env?.DEV;

function checkProxy() {
  const url = isDev ? '/api/ai-status' : '/api/ai';
  proxyChecked = fetch(url, { signal: AbortSignal.timeout(15000) })
    .then(async (r) => {
      if (!(r.headers.get('content-type') ?? '').includes('application/json')) return;
      const j = await r.json() as { providers?: string[] };
      const list = j.providers ?? [];
      // Claude나 서버 Vertex가 있으면 프록시가 더 빠르고 좋다. Gemini 키만 있으면 예비로만 쓴다
      proxy = { on: list.length > 0, first: list.includes('claude') || list.includes('vertex'), claude: list.includes('claude') };
    })
    .catch(() => { /* 함수가 없거나 응답이 없으면 Firebase AI Logic만 쓴다 */ });
}
if (typeof window !== 'undefined') checkProxy();

async function viaProxy(task: AiTask, user: string, signal: AbortSignal): Promise<{ text: string; model?: string; usage?: AiUsage }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // 배포된 함수는 App Check 토큰으로 이 게임 페이지에서 온 요청인지 확인한다
  if (!isDev) {
    const token = await appCheckToken();
    if (token) headers['X-Firebase-AppCheck'] = token;
  }
  // 사건 AI는 서버가 이용권을 확인한다. 로그인했으면 ID 토큰을 함께 보낸다
  const auth = await authHeader();
  if (auth) headers.Authorization = auth;
  const post = () => fetch('/api/ai', { method: 'POST', headers, body: JSON.stringify({ task, user }), signal });
  let r = await post();
  // App Check에 걸리면 토큰을 새로 받아 한 번 더 보낸다 (절전에서 깨어나 만료된 토큰 등). 그래도 걸리면 이 브라우저는 보안 확인을 못 받는 것이다
  const appCheckRejected = async () => r.status === 401 && (await r.clone().json().catch(() => null) as { error?: string } | null)?.error === 'app-check';
  if (!isDev && await appCheckRejected()) {
    const token = await appCheckToken(true);
    if (token) { headers['X-Firebase-AppCheck'] = token; r = await post(); }
    if (await appCheckRejected()) throw new Error(APP_CHECK_BLOCKED);
  }
  const type = r.headers.get('content-type') ?? '';
  // 함수가 배포되지 않았으면 호스팅이 index.html을 돌려준다
  if (!type.includes('application/json')) { proxy = { on: false, first: false, claude: false }; throw new Error('proxy-missing'); }
  const j = await r.json() as { text?: string; error?: string; provider?: string; model?: string; usage?: AiUsage };
  if (!r.ok) {
    if (r.status === 503 || r.status === 404 || r.status === 405) proxy = { on: false, first: false, claude: false };
    throw new Error(`proxy ${r.status} ${j.error ?? ''}`);
  }
  if (typeof j.text !== 'string') throw new Error('proxy-empty');
  return { text: j.text, model: j.model, usage: j.usage };
}

// ─────────────── 경로 ② Firebase AI Logic ───────────────

type Model = { generateContent: (s: string, o?: { signal?: AbortSignal; timeout?: number }) => Promise<{ response: { text(): string } }> };
const firebaseModels = new Map<string, Model>();
let firebaseInit: Promise<{ ai: unknown; mod: typeof import('firebase/ai'); appCheck: unknown }> | null = null;

/**
 * Vertex AI의 gemini-2.5-flash-lite: 응답 1~2초로 고르고 해석 정확도도 가장 높았다(scripts/interpret-eval.ts, 2026-10-13).
 * gemini-3.5-flash-lite는 같은 날 5~12초로 들쭉날쭉했고, gemini-3.5-flash는 요청이 자주 멈췄다. (개발자 API에서는 2.5를 신규 프로젝트에 쓸 수 없지만 Vertex에서는 쓸 수 있다)
 */
export const AI_MODEL: string =
  (isDev && typeof localStorage !== 'undefined' && localStorage.getItem('ai-model')) || import.meta.env?.VITE_GEMINI_MODEL || 'gemini-2.5-flash-lite';

async function firebaseBackend() {
  firebaseInit ??= (async () => {
    const { getApp, getApps, initializeApp } = await import('firebase/app');
    const mod = await import('firebase/ai');
    // 로그인(src/account)과 같은 앱을 쓴다
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    let appCheck: unknown = null;
    // AI Logic은 App Check로 보호된다. 로컬 개발에서는 디버그 토큰을 쓴다(.env.local의 APPCHECK_DEBUG_TOKEN을 콘솔에 등록).
    if (appCheckSiteKey || isDev) {
      if (isDev) (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN = __APPCHECK_DEBUG_TOKEN__ || true;
      const { initializeAppCheck, ReCaptchaEnterpriseProvider, CustomProvider } = await import('firebase/app-check');
      // 로컬에서는 reCAPTCHA를 띄우지 않는다. localhost는 키의 허용 도메인이 아니라 SDK가 무한 대기한다. 디버그 토큰만 쓴다.
      const provider = isDev
        ? new CustomProvider({ getToken: () => Promise.reject(new Error('로컬 개발은 디버그 토큰만 사용')) })
        : new ReCaptchaEnterpriseProvider(appCheckSiteKey);
      appCheck = initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: true });
    }
    // Vertex AI(Agent Platform) 백엔드: 개발자 API와 같은 모델·비슷한 가격이지만 더 빠르고 한도가 넉넉하며, Cloud Billing 후불이라 선불 크레딧이 필요 없다
    return { ai: mod.getAI(app, { backend: new mod.AgentPlatformBackend('global') }), mod, appCheck };
  })();
  try {
    return await firebaseInit;
  } catch (e) {
    firebaseInit = null; // 초기화 실패(네트워크)는 다음 요청에서 다시 시도한다
    throw e;
  }
}

/**
 * 서버가 App Check로 요청을 거절했다는 표시. 페이지는 열리는데 AI만 안 되는 경우다
 * (2026-10-28 실서버: Mac Chrome 한 대에서 /api/ai·/api/log 요청이 모두 401. 같은 시각 다른 플레이어는 정상).
 * reCAPTCHA나 App Check 서버 요청이 광고·추적 차단, 회사·학교 네트워크, VPN 등에 막히면 토큰을 못 받는다
 */
export const APP_CHECK_BLOCKED = 'app-check-blocked';
/** 보안 확인에 막혔을 때 대화창에 보여 줄 말 */
export const APP_CHECK_HELP = '브라우저 보안 확인에 막혀 AI에 닿지 못했다.\n광고·추적 차단 확장이나 VPN을 끄고 새로고침하거나, 다른 브라우저로 열어 보자.';
export const isAppCheckBlocked = (e: unknown) => e instanceof AiUnavailable && e.attempts.length > 0 && e.attempts.every((a) => a.endsWith(APP_CHECK_BLOCKED));

export async function appCheckToken(forceRefresh = false): Promise<string | null> {
  try {
    const { appCheck } = await firebaseBackend();
    if (!appCheck) return null;
    const { getToken } = await import('firebase/app-check');
    return (await getToken(appCheck as Parameters<typeof getToken>[0], forceRefresh)).token;
  } catch (e) {
    if (isDev) console.warn('[App Check] 토큰을 받지 못함:', e);
    return null;
  }
}

async function viaFirebase(task: AiTask, user: string, signal: AbortSignal, timeout: number): Promise<string> {
  const t = TASKS[task];
  let model = firebaseModels.get(task);
  if (!model) {
    const { ai, mod } = await firebaseBackend();
    model = mod.getGenerativeModel(ai as Parameters<typeof mod.getGenerativeModel>[0], {
      model: AI_MODEL,
      systemInstruction: t.system,
      // 해석은 분류 작업이라 생각 단계를 낮게 둬서 응답을 빠르게 한다
      generationConfig: {
        responseMimeType: 'application/json', responseJsonSchema: t.schema, temperature: t.temperature,
        ...(AI_MODEL.includes('lite') ? {} : { thinkingConfig: { thinkingLevel: mod.ThinkingLevel.LOW } }),
      },
    }) as Model;
    firebaseModels.set(task, model);
  }
  const res = await model.generateContent(joinParts(user), { signal, timeout });
  return res.response.text();
}

// ─────────────── 재시도·헤지 ───────────────

const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
  const t = setTimeout(resolve, ms);
  signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

/**
 * 검사에 걸린 답. 다음 시도는 프롬프트 끝에 note(걸린 답과 고칠 점)를 붙여 보낸다.
 * 같은 프롬프트를 그대로 다시 보내면 같은 실수를 되풀이하기 쉽다 (2026-10-19)
 */
export class Rejected extends Error {
  constructor(message: string, public note: string) { super(message); }
}

export class AiUnavailable extends Error {
  /** rejected: 답은 왔지만 검사(Rejected)에 걸린 시도 수. 모두 이것이면 AI에는 닿은 것이다 */
  constructor(public attempts: string[], public rejected = 0) { super(`AI 응답 없음: ${attempts.join(' / ')}`); }
}

/** 지금 쓸 수 있는 경로 (먼저 시도할 것부터) */
function routes(): Route[] {
  if (proxy.claude) return ['proxy'];
  if (!proxy.on) return ['firebase'];
  return proxy.first ? ['proxy', 'firebase'] : ['firebase', 'proxy'];
}

/**
 * AI에 한 작업을 맡기고 JSON 문자열을 받는다. 모든 시도가 실패하면 AiUnavailable을 던진다.
 * 시도 하나 = 한 경로에 한 번 보내기. 늦으면(hedgeMs) 다음 경로로 동시에 하나 더 보내고, 실패하면 다음 경로로 다시 보낸다.
 */
export async function callAI(task: AiTask, user: string, opts: CallOptions = {}): Promise<string> {
  const attemptMs = opts.attemptMs ?? 25000;
  const hedgeMs = opts.hedgeMs ?? 10000;
  const budgetMs = opts.budgetMs ?? 60000;
  const deadline = Date.now() + budgetMs;
  const all = new AbortController();
  const errors: string[] = [];
  let launched = 0;
  let running = 0;
  // 마지막으로 검사에 걸린 답의 고칠 점. 다음 시도부터 프롬프트 끝(캐시하지 않는 칸)에 붙인다
  let fix = '';
  let rejected = 0;
  const maxAttempts = 4;
  // 첫 요청은 프록시 상태를 알 때까지 잠깐 기다린다 (Claude가 있는데 다른 경로로 보내지 않게)
  await Promise.race([proxyChecked, new Promise((r) => setTimeout(r, 5000))]);
  // 경로가 하나뿐이면 늦을 때 같은 곳에 하나 더 보내게 되므로 (비용이 두 배) 더 오래 기다린다
  const hedgeAfter = routes().length > 1 ? hedgeMs : Math.max(hedgeMs, 7000);

  return new Promise<string>((resolve, reject) => {
    let done = false;
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      if (hedgeTimer) clearTimeout(hedgeTimer);
      all.abort();
      fn();
    };
    const fail = () => finish(() => reject(new AiUnavailable(errors, rejected)));

    const launch = async () => {
      // 보안 확인에 막힌 브라우저는 다시 보내도 똑같이 막힌다
      const blocked = errors.length > 0 && errors.every((x) => x.endsWith(APP_CHECK_BLOCKED));
      if (done || blocked || launched >= maxAttempts || Date.now() >= deadline) { if (!running) fail(); return; }
      const n = launched++;
      running++;
      const list = routes();
      const route = list[n % list.length];
      const ctl = new AbortController();
      const onAll = () => ctl.abort();
      all.signal.addEventListener('abort', onAll, { once: true });
      const limit = Math.min(attemptMs, Math.max(1000, deadline - Date.now()));
      const timer = setTimeout(() => ctl.abort(), limit);
      const started = Date.now();
      // 이 시도가 hedgeMs 넘게 걸리면 다른 경로로 하나 더 보낸다
      if (hedgeTimer) clearTimeout(hedgeTimer);
      hedgeTimer = setTimeout(() => { if (!done && running === 1) void launch(); }, hedgeAfter);
      try {
        const prompt = user + fix;
        const { text, model, usage } = route === 'proxy' ? await viaProxy(task, prompt, ctl.signal) : { text: await viaFirebase(task, prompt, ctl.signal, limit), model: AI_MODEL, usage: undefined };
        // 답은 왔다. 검사(대사 판정 AI 포함)가 길어져도 같은 요청을 하나 더 보내지 않는다
        if (hedgeTimer) clearTimeout(hedgeTimer);
        if (opts.parse) await opts.parse(text);
        record({ task, route, ok: true, ms: Date.now() - started, at: Date.now(), ...(model ? { model } : {}), ...(usage ? { usage } : {}) });
        finish(() => resolve(text));
      } catch (e) {
        const msg = ctl.signal.aborted && !all.signal.aborted ? 'timeout' : e instanceof Error ? e.message : String(e);
        if (e instanceof Rejected && !all.signal.aborted) { fix = e.note; rejected++; }
        if (!all.signal.aborted) {
          errors.push(`${route}: ${msg}`);
          record({ task, route, ok: false, ms: Date.now() - started, error: msg, at: Date.now() });
          if (isDev) console.warn(`[AI ${task}] ${route} 실패 (${Date.now() - started}ms):`, msg);
        }
      } finally {
        clearTimeout(timer);
        all.signal.removeEventListener('abort', onAll);
        running--;
      }
      if (done) return;
      // 다른 시도가 아직 진행 중이면 그 결과를 기다린다. 아니면 잠깐 쉬었다 다음 경로로 다시 보낸다
      if (running > 0) return;
      await sleep(Math.min(250 * 2 ** Math.max(0, launched - 1), 1500), all.signal);
      void launch();
    };
    void launch();
  });
}
