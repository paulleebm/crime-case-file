import { timingSafeEqual } from 'node:crypto';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';
import { defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { onRequest } from 'firebase-functions/v2/https';
import { AiHttpError, providers, runAi, type AiEnv } from '../../server/aiHandler';
import { CHAT_TYPES, FLOW_TYPES, SUMMARY_TYPES, summarizeRuns } from '../../server/playSummary';

// 배포용 AI 프록시. Firebase Hosting의 /api/ai 를 이 함수로 돌린다 (firebase.json rewrites).
// 공급자 순서는 server/aiHandler.ts의 providers(): Claude → OpenAI → Vertex AI Gemini → Gemini 개발자 API (켠 것만 쓴다).
// Vertex는 함수의 서비스 계정으로 인증하므로 키가 필요 없다. 브라우저는 이 함수를 첫 경로로, Firebase AI Logic을 예비 경로로 쓴다.
//
// 다른 공급자를 더 켜는 법:
//   Claude: firebase functions:secrets:set ANTHROPIC_API_KEY  → functions/.env 에 ENABLE_CLAUDE=true
//   Gemini: firebase functions:secrets:set GEMINI_API_KEY     → functions/.env 에 ENABLE_GEMINI=true
//   OpenAI(Claude 실패 때 대체): firebase functions:secrets:set OPENAI_API_KEY → functions/.env 에 ENABLE_OPENAI=true
//   그다음 firebase deploy --only functions
// Claude를 켜면 브라우저가 이 함수를 첫 경로로 쓰고, Gemini만 켜면 Firebase AI Logic 다음 경로로 쓴다.
//
// 게임 페이지가 아닌 곳에서 쓰지 못하게 App Check 토큰을 확인하고, 접속 주소마다 요청 수를 제한한다.

initializeApp();

/** 배포할 때 functions/.env 에서 읽는다. 비밀 값을 등록하지 않은 채 켜면 배포가 멈추므로 기본은 끈다 */
const CLAUDE_ON = process.env.ENABLE_CLAUDE === 'true';
const GEMINI_ON = process.env.ENABLE_GEMINI === 'true';
// Claude가 실패하면(크레딧 소진·장애) OpenAI로 넘긴다. 임시 키라 끄려면 functions/.env 의 ENABLE_OPENAI=false
const OPENAI_ON = process.env.ENABLE_OPENAI === 'true';
const VERTEX_ON = process.env.ENABLE_VERTEX !== 'false';
// 켜지 않은 키는 정의하지도 않는다 (정의만 해도 배포 도구가 Secret Manager에서 찾는다)
// Claude 키는 항상 연결한다: 배포 도구가 함수를 분석할 때는 functions/.env가 아직 읽히지 않아 CLAUDE_ON으로 고르면 키가 빠진다.
// (Secret Manager에 ANTHROPIC_API_KEY가 있어야 배포된다. 쓰는지는 실행 중에 ENABLE_CLAUDE로 정한다)
const ANTHROPIC_API_KEY = defineSecret('ANTHROPIC_API_KEY');
const GEMINI_API_KEY = GEMINI_ON ? defineSecret('GEMINI_API_KEY') : null;
// Claude 키와 같은 이유로 항상 연결한다 (Secret Manager에 OPENAI_API_KEY가 있어야 배포된다)
const OPENAI_API_KEY = defineSecret('OPENAI_API_KEY');
const OPENAI_MODEL = defineString('OPENAI_MODEL', { default: 'gpt-6.1-sol' });
const ANTHROPIC_MODEL = defineString('ANTHROPIC_MODEL', { default: 'claude-sonnet-5-5' });
const ANTHROPIC_TASK_MODELS = defineString('ANTHROPIC_TASK_MODELS', { default: 'none' });
const GEMINI_MODEL = defineString('GEMINI_MODEL', { default: 'gemini-3.5-flash-lite' });
const VERTEX_MODEL = defineString('VERTEX_MODEL', { default: 'gemini-2.5-flash-lite' });

/** 접속 주소별 분당 요청 수 (인스턴스 안에서만 세는 간이 제한. 정상 플레이는 분당 10회를 넘지 않는다) */
const PER_MINUTE = 40;
const hits = new Map<string, { n: number; at: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  const h = hits.get(ip);
  if (!h || now - h.at > 60_000) { hits.set(ip, { n: 1, at: now }); return false; }
  h.n++;
  return h.n > PER_MINUTE;
}

function env(): AiEnv {
  return {
    ANTHROPIC_API_KEY: CLAUDE_ON ? secretValue(ANTHROPIC_API_KEY) : undefined,
    ANTHROPIC_MODEL: ANTHROPIC_MODEL.value(),
    ANTHROPIC_TASK_MODELS: ANTHROPIC_TASK_MODELS.value(),
    GEMINI_API_KEY: secretValue(GEMINI_API_KEY),
    GEMINI_MODEL: GEMINI_MODEL.value(),
    VERTEX_PROJECT: VERTEX_ON ? process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT : undefined,
    VERTEX_MODEL: VERTEX_MODEL.value(),
    OPENAI_API_KEY: OPENAI_ON ? secretValue(OPENAI_API_KEY) : undefined,
    OPENAI_MODEL: OPENAI_MODEL.value(),
  };
}

export const ai = onRequest(
  {
    region: 'asia-northeast3',
    secrets: [ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY].filter((x): x is NonNullable<typeof x> => !!x),
    timeoutSeconds: 90, memory: '256MiB', minInstances: 0, concurrency: 40,
  },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    // 상태 확인: 브라우저가 어느 경로를 먼저 쓸지 고르는 데 쓴다 (비밀 값은 돌려주지 않는다)
    if (req.method === 'GET') { res.json({ providers: providers(env()) }); return; }
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    const token = req.header('X-Firebase-AppCheck');
    try {
      if (!token) throw new Error('no token');
      await getAppCheck().verifyToken(token);
    } catch (e) {
      // 페이지는 열리는데 AI만 안 된다는 제보를 가려내려고 남긴다 (토큰이 없음 = 브라우저가 reCAPTCHA·App Check 토큰을 못 받음)
      console.warn('[ai] app-check 거절', token ? `토큰 무효: ${e instanceof Error ? e.message : e}` : '토큰 없음', req.header('user-agent') ?? '');
      res.status(401).json({ error: 'app-check' });
      return;
    }
    if (limited(req.ip ?? 'unknown')) { res.status(429).json({ error: 'rate' }); return; }
    const abort = new AbortController();
    res.on('close', () => { if (!res.writableEnded) abort.abort(); });
    try {
      res.json(await runAi(req.body, env(), abort.signal));
    } catch (e) {
      const err = e instanceof AiHttpError ? e : new AiHttpError(500, 'proxy', String(e));
      console.warn('[ai] 실패', err.status, err.code, err.message);
      res.status(err.status).json({ error: err.code });
    }
  },
);

/**
 * 플레이 기록 (/api/log). 게임이 보낸 사건을 사건 하나당 Cloud Logging 항목 하나로 남긴다 (jsonPayload.kind = "play").
 * 보기: 게임 주소의 /bymile (아래 logs 함수가 읽어 준다), 또는 npx tsx scripts/play-logs.ts  (Cloud Logging 기본 보관 30일)
 * 기기 ID·판 ID는 브라우저가 만든 무작위 값이다. 접속 주소(ip)는 운영자가 플레이를 사람별로 묶어 보려고 함께 남긴다.
 */
const LOG_PER_MINUTE = 60;
const logHits = new Map<string, { n: number; at: number }>();
const ID = /^[a-z0-9]{6,32}$/;
export const log = onRequest(
  { region: 'asia-northeast3', timeoutSeconds: 20, memory: '256MiB', minInstances: 0, concurrency: 80 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    const token = req.header('X-Firebase-AppCheck');
    try {
      if (!token) throw new Error('no token');
      await getAppCheck().verifyToken(token);
    } catch {
      res.status(401).json({ error: 'app-check' });
      return;
    }
    const ip = clientIp(req);
    const now = Date.now();
    const h = logHits.get(ip);
    if (!h || now - h.at > 60_000) logHits.set(ip, { n: 1, at: now });
    else if (++h.n > LOG_PER_MINUTE) { res.status(429).json({ error: 'rate' }); return; }
    const body = req.body as { uid?: unknown; run?: unknown; events?: unknown };
    const raw = req.rawBody?.length ?? 0;
    if (raw > 70_000 || typeof body?.uid !== 'string' || typeof body.run !== 'string' || !ID.test(body.uid) || !ID.test(body.run) || !Array.isArray(body.events) || body.events.length > 60) {
      res.status(400).json({ error: 'bad' });
      return;
    }
    for (const e of body.events as Record<string, unknown>[]) {
      if (!e || typeof e !== 'object' || typeof e.type !== 'string') continue;
      const { type, at, ...rest } = e;
      logger.info(`play ${type}`, { kind: 'play', uid: body.uid, run: body.run, type, at: typeof at === 'number' ? new Date(at).toISOString() : undefined, ...rest, ip });
    }
    res.status(204).end();
  },
);

/** 접속한 사람의 주소. Hosting을 거치면 x-forwarded-for의 첫 값이 실제 주소다 */
function clientIp(req: { header(name: string): string | undefined; ip?: string }): string {
  const fwd = req.header('x-forwarded-for')?.split(',')[0]?.trim();
  return (fwd || req.ip || 'unknown').slice(0, 64);
}

/**
 * 플레이 기록 열람 (/api/logs). /bymile 화면이 부른다. Cloud Logging에서 플레이 사건을 읽어 돌려준다.
 *   GET /api/logs?days=7                                판 목록: 서버에서 판 하나당 한 줄로 요약해 돌려준다 (대화 본문은 읽지 않는다)
 *   GET /api/logs?runs=ID,ID&from=ms&to=ms&part=flow    한 판의 진행 흐름 (대화 제외)
 *   GET /api/logs?runs=ID,ID&from=ms&to=ms&part=chat    한 판의 대화
 *   POST /api/logs {"since": ms | null}                 이 시각 이전 기록은 목록에서 보지 않기 (null이면 해제)
 * 기준 시각은 Cloud Logging에 한 줄(kind="viewer", type="cutoff")로 남겨 어느 기기에서 열어도 같게 한다. 기록 자체는 지우지 않는다.
 * 열람 키: firebase functions:secrets:set LOG_VIEWER_KEY  (요청 머리글 X-Viewer-Key로 보낸다)
 */
const LOG_VIEWER_KEY = defineSecret('LOG_VIEWER_KEY');
const PROJECT = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'crime-case-file';
const viewerMiss = new Map<string, { n: number; at: number }>();
const viewCache = new Map<string, { at: number; body: unknown }>();
const typesIn = (xs: string[]) => `jsonPayload.type=(${xs.map((t) => `"${t}"`).join(' OR ')})`;
export const logs = onRequest(
  { region: 'asia-northeast3', secrets: [LOG_VIEWER_KEY], timeoutSeconds: 60, memory: '512MiB', minInstances: 0, concurrency: 10 },
  async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex');
    if (req.method !== 'GET' && req.method !== 'POST') { res.status(405).json({ error: 'method' }); return; }
    const ip = clientIp(req);
    const now = Date.now();
    const miss = viewerMiss.get(ip);
    if (miss && now - miss.at < 10 * 60_000 && miss.n >= 10) { res.status(429).json({ error: 'rate' }); return; }
    const want = secretValue(LOG_VIEWER_KEY) ?? '';
    const got = req.header('X-Viewer-Key') ?? '';
    const ok = want.length > 0 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
    if (!ok) {
      viewerMiss.set(ip, !miss || now - miss.at > 10 * 60_000 ? { n: 1, at: now } : { n: miss.n + 1, at: miss.at });
      res.status(401).json({ error: 'key' });
      return;
    }
    if (req.method === 'POST') {
      const v = (req.body as { since?: unknown })?.since;
      const since = typeof v === 'number' && v > 0 && v <= now + 60_000 ? Math.round(v) : null;
      logger.info('viewer cutoff', { kind: 'viewer', type: 'cutoff', since });
      cutoffCache = { at: now, since };
      viewCache.clear();
      res.json({ since });
      return;
    }
    const q = req.query as Record<string, unknown>;
    const runs = String(q.runs ?? q.run ?? '').split(',').filter((x) => ID.test(x)).slice(0, 20);
    const part = q.part === 'chat' ? 'chat' : 'flow';
    const days = Math.min(30, Math.max(1, Number(q.days) || 7));
    const key = runs.length ? `${runs.join(',')}|${part}` : `list|${days}`;
    const hit = viewCache.get(key);
    // 목록은 1분, 한 판은 판이 끝났을 수 있어도 20초만 기억한다
    if (hit && now - hit.at < (runs.length ? 20_000 : 60_000)) { res.json(hit.body); return; }
    try {
      let body: unknown;
      if (runs.length) {
        // 판이 있었던 시각 앞뒤로만 찾는다 (기간 전체를 훑지 않는다)
        const from = Number(q.from) || now - 30 * 86_400_000;
        const to = Number(q.to) || now;
        const range = `timestamp>="${new Date(from - 2 * 3_600_000).toISOString()}" AND timestamp<="${new Date(Math.min(now, to + 2 * 3_600_000)).toISOString()}"`;
        // kind로 거르지 않는다: 2026-10-14 전의 답 대화는 kind가 덮어써졌다
        const filter = `${range} AND jsonPayload.run=(${runs.map((r) => `"${r}"`).join(' OR ')}) AND ${typesIn(part === 'chat' ? CHAT_TYPES : FLOW_TYPES)}`;
        body = { runs, part, events: await readLogs(filter, 20), at: now };
      } else {
        const cutoff = await readCutoff(now);
        const since = new Date(Math.max(now - days * 86_400_000, cutoff ?? 0)).toISOString();
        const filter = `jsonPayload.kind="play" AND timestamp>="${since}" AND ${typesIn(SUMMARY_TYPES)}`;
        body = { days, cutoff, runs: summarizeRuns(await readLogs(filter, 60)), at: now };
      }
      viewCache.set(key, { at: now, body });
      if (viewCache.size > 50) viewCache.delete(viewCache.keys().next().value!);
      res.json(body);
    } catch (e) {
      console.warn('[logs] 읽기 실패', String(e));
      res.status(502).json({ error: 'read', message: String(e).slice(0, 300) });
    }
  },
);

/** 목록에서 감출 기준 시각. 가장 최근에 남긴 기준을 읽는다 (인스턴스마다 30초 기억) */
let cutoffCache: { at: number; since: number | null } | null = null;
async function readCutoff(now: number): Promise<number | null> {
  if (cutoffCache && now - cutoffCache.at < 30_000) return cutoffCache.since;
  const since = new Date(now - 30 * 86_400_000).toISOString();
  const [last] = await readLogs(`jsonPayload.kind="viewer" AND jsonPayload.type="cutoff" AND timestamp>="${since}"`, 1, 'desc', 1);
  const v = typeof last?.since === 'number' ? last.since : null;
  cutoffCache = { at: now, since: v };
  return v;
}

/** Cloud Logging entries:list 를 쪽마다 넘기며 읽는다. 함수의 서비스 계정으로 인증한다 */
async function readLogs(filter: string, maxPages: number, order: 'asc' | 'desc' = 'asc', pageSize = 1000): Promise<Record<string, unknown>[]> {
  const { access_token } = await applicationDefault().getAccessToken();
  const out: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const r = await fetch('https://logging.googleapis.com/v2/entries:list', {
      method: 'POST',
      headers: { Authorization: `Bearer ${access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceNames: [`projects/${PROJECT}`], filter, orderBy: `timestamp ${order}`, pageSize, ...(pageToken ? { pageToken } : {}) }),
    });
    if (!r.ok) throw new Error(`logging ${r.status} ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { entries?: { timestamp?: string; jsonPayload?: Record<string, unknown> }[]; nextPageToken?: string };
    for (const e of j.entries ?? []) {
      if (!e.jsonPayload) continue;
      const { message: _m, ...p } = e.jsonPayload;
      if (!p.at) p.at = e.timestamp;
      out.push(p);
    }
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return out;
}

/** 읽을 수 없는 비밀 값은 빈 값으로 본다 (그러면 다음 공급자를 쓴다) */
function secretValue(s: ReturnType<typeof defineSecret> | null): string | undefined {
  if (!s) return undefined;
  try { return s.value() || undefined; } catch { return undefined; }
}
