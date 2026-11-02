import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { AiHttpError, providers, runAi, type AiEnv } from '../server/aiHandler';
import { CHAT_TYPES, FLOW_TYPES, SUMMARY_TYPES, summarizeRuns } from '../server/playSummary';
import { aiGate, billingRoutes } from './billingDev';
import type { BillingEnv } from '../server/billing';

// 로컬 개발용 AI 프록시. 배포 때의 Cloud Function(functions/src/index.ts)과 같은 runAi를 쓴다.
// API 키는 이 Node 프로세스 안에서만 읽고 브라우저로 보내지 않는다.
// .env.local 을 요청마다 다시 읽으므로 키를 넣은 뒤 서버를 재시작하지 않아도 된다.

function readEnv(root: string): AiEnv & BillingEnv & { PAYWALL?: string } {
  const file = path.join(root, '.env.local');
  if (!fs.existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return env;
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export function aiProxy(): Plugin {
  let root = process.cwd();
  return {
    name: 'ai-dev-proxy',
    apply: 'serve',
    configResolved(cfg) {
      root = cfg.root;
    },
    configureServer(server) {
      // 로그인·결제·관리자 API (dev/billingDev.ts)
      for (const [at, mw] of billingRoutes(() => root, () => readEnv(root))) server.middlewares.use(at, mw);

      server.middlewares.use('/api/ai-status', (_req, res) => {
        const env = readEnv(root);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ providers: providers(env), claudeModel: env.ANTHROPIC_MODEL || 'claude-sonnet-5-5', geminiModel: env.GEMINI_MODEL || 'gemini-3.5-flash-lite' }));
      });

      // 플레이 기록: 로컬에서는 dev-logs/play.jsonl 에 사건 하나당 한 줄로 남긴다
      // 기록 열람 (/bymile): 배포된 logs 함수처럼 요약 또는 한 판의 사건을 돌려준다 (로컬은 열람 키를 묻지 않는다)
      // 목록에서 감출 기준 시각 (배포 함수는 Cloud Logging에 남긴다)
      const cutoffFile = path.join(root, 'dev-logs', 'viewer-cutoff.json');
      const readCutoff = (): number | null => { try { return JSON.parse(fs.readFileSync(cutoffFile, 'utf8')).since ?? null; } catch { return null; } };
      server.middlewares.use('/api/logs', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST') {
          const v = (JSON.parse(await readBody(req) || '{}') as { since?: unknown }).since;
          const since = typeof v === 'number' && v > 0 ? Math.round(v) : null;
          fs.mkdirSync(path.dirname(cutoffFile), { recursive: true });
          fs.writeFileSync(cutoffFile, JSON.stringify({ since }));
          res.end(JSON.stringify({ since }));
          return;
        }
        const q = new URL(req.url ?? '', 'http://x').searchParams;
        const days = Math.min(30, Math.max(1, Number(q.get('days')) || 7));
        const runs = (q.get('runs') ?? q.get('run') ?? '').split(',').filter(Boolean);
        const part = q.get('part') === 'chat' ? CHAT_TYPES : FLOW_TYPES;
        const cutoff = readCutoff();
        const since = Math.max(Date.now() - days * 86_400_000, cutoff ?? 0);
        let events: Record<string, unknown>[] = [];
        try {
          events = fs.readFileSync(path.join(root, 'dev-logs', 'play.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
        } catch { /* 기록 없음 */ }
        if (runs.length) {
          res.end(JSON.stringify({ runs, events: events.filter((e) => runs.includes(e.run as string) && part.includes(e.type as string)), at: Date.now() }));
          return;
        }
        events = events.filter((e) => +new Date(e.at as string | number) >= since && SUMMARY_TYPES.includes(e.type as string));
        res.end(JSON.stringify({ days, cutoff, runs: summarizeRuns(events), at: Date.now() }));
      });

      server.middlewares.use('/api/log', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        try {
          const { uid, run, events } = JSON.parse(await readBody(req)) as { uid: string; run: string; events: Record<string, unknown>[] };
          const dir = path.join(root, 'dev-logs');
          fs.mkdirSync(dir, { recursive: true });
          fs.appendFileSync(path.join(dir, 'play.jsonl'), events.map((e) => JSON.stringify({ uid, run, ...e, ip: req.socket.remoteAddress ?? 'local' })).join('\n') + '\n');
          res.statusCode = 204;
        } catch {
          res.statusCode = 400;
        }
        res.end();
      });

      server.middlewares.use('/api/ai', async (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        // 배포된 함수와 같이 GET은 상태를 돌려준다
        if (req.method === 'GET') { res.end(JSON.stringify({ providers: providers(readEnv(root)) })); return; }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end(JSON.stringify({ error: 'method' }));
          return;
        }
        const abort = new AbortController();
        res.on('close', () => { if (!res.writableEnded) abort.abort(); });
        try {
          const body = JSON.parse(await readBody(req));
          const env = readEnv(root);
          // 사건 AI는 이용권이 있어야 쓴다 (PAYWALL=off 이면 끈다)
          const blocked = env.PAYWALL === 'off' ? null : await aiGate(req, body?.task, root, env);
          if (blocked) throw new AiHttpError(blocked[0], blocked[1], blocked[1]);
          const out = await runAi(body, env, abort.signal);
          res.end(JSON.stringify(out));
        } catch (e) {
          const err = e instanceof AiHttpError ? e : new AiHttpError(500, 'proxy', String(e));
          res.statusCode = err.status;
          res.end(JSON.stringify({ error: err.code, message: err.message }));
        }
      });
    },
  };
}
