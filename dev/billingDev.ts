import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  accessOf, adminView, BillingError, confirmPayment, createOrder, emptyDb, requireAdmin, setFreeEmails,
  type BillingDb, type BillingEnv, type Viewer,
} from '../server/billing';

// 로컬 개발용 로그인·결제 API. 이용권 기록은 dev-data/billing.json 에 둔다 (배포하지 않는 로컬 전용).
//   GET  /api/me            로그인한 사람의 이용권 상태
//   POST /api/pay/order     주문 만들기
//   POST /api/pay/confirm   토스 결제 승인
//   GET  /api/admin         관리자: 무료 이메일·결제 목록
//   POST /api/admin         관리자: 무료 이메일 목록 저장
// 로그인 확인: 브라우저가 Firebase Auth ID 토큰을 Authorization: Bearer 로 보내고, firebase-admin이 Google 공개 키로 서명을 확인한다 (서비스 계정 키 필요 없음).

const PROJECT_ID = 'crime-case-file';

function auth() {
  const app = getApps().find((a) => a.name === 'billing') ?? initializeApp({ projectId: PROJECT_ID }, 'billing');
  return getAuth(app);
}

/** 로그인하지 않았거나 토큰이 틀리면 null */
export async function viewerOf(req: IncomingMessage): Promise<Viewer | null> {
  const m = (req.headers.authorization ?? '').match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const t = await auth().verifyIdToken(m[1]);
    if (!t.email) return null;
    return { uid: t.uid, email: t.email, emailVerified: t.email_verified === true };
  } catch {
    return null;
  }
}

export function dbFile(root: string) { return path.join(root, 'dev-data', 'billing.json'); }

export function loadDb(root: string): BillingDb {
  try { return { ...emptyDb(), ...JSON.parse(fs.readFileSync(dbFile(root), 'utf8')) }; } catch { return emptyDb(); }
}

function saveDb(root: string, db: BillingDb) {
  fs.mkdirSync(path.dirname(dbFile(root)), { recursive: true });
  fs.writeFileSync(dbFile(root), JSON.stringify(db, null, 2));
}

/** AI 요청을 막아야 하면 [상태 코드, 이유] */
export async function aiGate(req: IncomingMessage, task: unknown, root: string, env: BillingEnv): Promise<[number, string] | null> {
  const v = await viewerOf(req);
  if (!v) return [401, 'login'];
  return accessOf(v, loadDb(root), env).full ? null : [402, 'paywall'];
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 100_000) req.destroy(); });
    req.on('end', () => { try { resolve(data ? JSON.parse(data) : {}); } catch { reject(new BillingError(400, 'json')); } });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

type Mw = (req: IncomingMessage, res: ServerResponse) => void;

export function billingRoutes(root: () => string, env: () => BillingEnv): [string, Mw][] {
  // 한 번에 하나씩 처리해 파일 기록이 서로 덮어쓰지 않게 한다
  let queue: Promise<unknown> = Promise.resolve();
  const route = (methods: string[], fn: (v: Viewer, db: BillingDb, body: unknown, method: string) => Promise<unknown> | unknown): Mw => (req, res) => {
    queue = queue.then(async () => {
      try {
        if (!methods.includes(req.method ?? '')) throw new BillingError(405, 'method');
        const v = await viewerOf(req);
        if (!v) throw new BillingError(401, 'login', '로그인이 필요합니다');
        const body = req.method === 'POST' ? await readBody(req) : undefined;
        const db = loadDb(root());
        const before = JSON.stringify(db);
        let out: unknown;
        try {
          out = await fn(v, db, body, req.method!);
        } finally {
          if (JSON.stringify(db) !== before) saveDb(root(), db); // 승인 실패 기록도 남긴다
        }
        send(res, 200, out);
      } catch (e) {
        const err = e instanceof BillingError ? e : new BillingError(500, 'server', String(e));
        if (err.status >= 500) console.warn('[billing]', err.message);
        send(res, err.status, { error: err.code, message: err.message });
      }
    });
  };
  return [
    ['/api/me', route(['GET'], (v, db) => accessOf(v, db, env()))],
    ['/api/pay/order', route(['POST'], (v, db) => createOrder(v, db, env()))],
    ['/api/pay/confirm', route(['POST'], (v, db, body) => confirmPayment(v, body, db, env()))],
    ['/api/admin', route(['GET', 'POST'], (v, db, body, method) => {
      requireAdmin(v, db, env());
      if (method === 'POST') setFreeEmails(db, body);
      return adminView(db);
    })],
  ];
}
