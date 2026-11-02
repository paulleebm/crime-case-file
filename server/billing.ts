// 이용권(전체 이용권 1회 구매)과 무료 이메일 관리. 저장 방식과 상관없는 순수 로직이다.
// 로컬 개발 서버(dev/billingDev.ts)가 JSON 파일에 저장해 쓴다. 배포할 때는 같은 함수를 Cloud Function + Firestore에 붙인다.
//
// 이용 가능 = 결제함 || 관리자가 무료로 지정한 이메일 || 관리자(ADMIN_EMAILS)
// 결제 흐름 (토스페이먼츠 결제창):
//   ① POST /api/pay/order    서버가 주문(orderId, 금액)을 만들어 둔다
//   ② 브라우저가 토스 결제창을 띄우고, 성공하면 /pay/success?paymentKey&orderId&amount 로 돌아온다
//   ③ POST /api/pay/confirm  서버가 저장해 둔 주문과 금액을 대조한 뒤 토스 승인 API를 부르고, 성공하면 이용권을 준다
//   (금액은 브라우저가 보낸 값을 믿지 않는다. 주문에 저장한 값과 같아야 승인한다)

export const ORDER_NAME = '미해결 사건 파일 전체 이용권';
export const DEFAULT_PRICE = 9900;

export interface BillingEnv {
  /** 관리자 이메일. 쉼표로 여러 개 */
  ADMIN_EMAILS?: string;
  TOSS_SECRET_KEY?: string;
  PRICE_KRW?: string;
}

export interface Purchase { uid: string; email: string; orderId: string; paymentKey: string; amount: number; method?: string; at: string }
export interface Order { orderId: string; uid: string; email: string; amount: number; status: 'ready' | 'done' | 'failed'; createdAt: string; error?: string }
export interface BillingDb {
  freeEmails: string[];
  /** uid → 결제 기록 */
  purchases: Record<string, Purchase>;
  orders: Record<string, Order>;
}

export const emptyDb = (): BillingDb => ({ freeEmails: [], purchases: {}, orders: {} });

/** 검증한 Google 로그인 사용자 */
export interface Viewer { uid: string; email: string; emailVerified: boolean }

export class BillingError extends Error {
  constructor(readonly status: number, readonly code: string, message = code) { super(message); }
}

export const normEmail = (s: string) => s.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function price(env: BillingEnv): number {
  const n = Number(env.PRICE_KRW);
  return Number.isInteger(n) && n >= 100 ? n : DEFAULT_PRICE;
}

const adminList = (env: BillingEnv) => (env.ADMIN_EMAILS ?? '').split(',').map(normEmail).filter(Boolean);

export interface Access { email: string; admin: boolean; free: boolean; paid: boolean; full: boolean; price: number }

export function accessOf(v: Viewer, db: BillingDb, env: BillingEnv): Access {
  // 무료·관리자 판정은 Google이 확인한 이메일만 믿는다
  const email = normEmail(v.email);
  const admin = v.emailVerified && adminList(env).includes(email);
  const free = v.emailVerified && db.freeEmails.includes(email);
  const paid = !!db.purchases[v.uid];
  return { email, admin, free, paid, full: admin || free || paid, price: price(env) };
}

export function createOrder(v: Viewer, db: BillingDb, env: BillingEnv, now = new Date()): { orderId: string; amount: number; orderName: string; customerKey: string } {
  if (accessOf(v, db, env).full) throw new BillingError(409, 'owned', '이미 이용권이 있습니다');
  // 토스 orderId: 영문·숫자·-·_ 6~64자
  const orderId = `ucf-${now.getTime().toString(36)}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const amount = price(env);
  db.orders[orderId] = { orderId, uid: v.uid, email: normEmail(v.email), amount, status: 'ready', createdAt: now.toISOString() };
  return { orderId, amount, orderName: ORDER_NAME, customerKey: v.uid };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function confirmPayment(
  v: Viewer, body: unknown, db: BillingDb, env: BillingEnv, doFetch: Fetch = fetch as unknown as Fetch, now = new Date(),
): Promise<Access> {
  const b = (body ?? {}) as { paymentKey?: unknown; orderId?: unknown; amount?: unknown };
  if (typeof b.paymentKey !== 'string' || typeof b.orderId !== 'string' || b.paymentKey.length > 200) throw new BillingError(400, 'bad');
  const order = db.orders[b.orderId];
  if (!order || order.uid !== v.uid) throw new BillingError(404, 'order', '주문을 찾을 수 없습니다');
  if (order.status === 'done') return accessOf(v, db, env); // 새로고침 등으로 두 번 와도 한 번만 승인한다
  if (Number(b.amount) !== order.amount) throw new BillingError(400, 'amount', '결제 금액이 주문과 다릅니다');
  if (!env.TOSS_SECRET_KEY) throw new BillingError(503, 'no-key', '서버에 토스 시크릿 키가 없습니다 (.env.local의 TOSS_SECRET_KEY)');
  const r = await doFetch('https://api.tosspayments.com/v1/payments/confirm', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${env.TOSS_SECRET_KEY}:`).toString('base64')}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': order.orderId,
    },
    body: JSON.stringify({ paymentKey: b.paymentKey, orderId: order.orderId, amount: order.amount }),
  });
  const j = (await r.json().catch(() => ({}))) as { status?: string; method?: string; totalAmount?: number; code?: string; message?: string };
  if (!r.ok || j.status !== 'DONE' || j.totalAmount !== order.amount) {
    order.status = 'failed';
    order.error = `${j.code ?? r.status} ${j.message ?? ''}`.trim();
    throw new BillingError(402, j.code ?? 'toss', j.message ?? '결제 승인에 실패했습니다');
  }
  order.status = 'done';
  db.purchases[v.uid] = { uid: v.uid, email: order.email, orderId: order.orderId, paymentKey: b.paymentKey, amount: order.amount, method: j.method, at: now.toISOString() };
  return accessOf(v, db, env);
}

export function requireAdmin(v: Viewer, db: BillingDb, env: BillingEnv) {
  if (!accessOf(v, db, env).admin) throw new BillingError(403, 'admin', '관리자만 볼 수 있습니다');
}

export function adminView(db: BillingDb) {
  return {
    freeEmails: [...db.freeEmails].sort(),
    purchases: Object.values(db.purchases).sort((a, b) => b.at.localeCompare(a.at)),
    orders: Object.values(db.orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50),
  };
}

/** 무료 이메일 목록을 통째로 바꾼다. 잘못된 주소가 하나라도 있으면 아무것도 바꾸지 않는다 */
export function setFreeEmails(db: BillingDb, body: unknown) {
  const list = (body as { freeEmails?: unknown })?.freeEmails;
  if (!Array.isArray(list) || list.length > 1000) throw new BillingError(400, 'bad');
  const out = [...new Set(list.map((x) => (typeof x === 'string' ? normEmail(x) : '')).filter(Boolean))];
  const badOne = out.find((e) => !EMAIL.test(e) || e.length > 254);
  if (badOne) throw new BillingError(400, 'email', `이메일 형식이 아닙니다: ${badOne}`);
  db.freeEmails = out;
}
