import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessOf, BillingError, confirmPayment, createOrder, emptyDb, setFreeEmails, type BillingEnv, type Viewer } from '../server/billing';

const env: BillingEnv = { ADMIN_EMAILS: 'Boss@Gmail.com', TOSS_SECRET_KEY: 'test_sk_x', PRICE_KRW: '9900' };
const alice: Viewer = { uid: 'u-alice', email: 'Alice@gmail.com', emailVerified: true };
const tossOk = async () => ({ ok: true, status: 200, json: async () => ({ status: 'DONE', totalAmount: 9900, method: '카드' }) });

test('관리자·무료 이메일은 대소문자와 상관없이, 확인된 이메일일 때만 이용권이 있다', () => {
  const db = emptyDb();
  assert.equal(accessOf(alice, db, env).full, false);
  assert.equal(accessOf({ uid: 'b', email: 'boss@gmail.com', emailVerified: true }, db, env).admin, true);
  assert.equal(accessOf({ uid: 'b', email: 'boss@gmail.com', emailVerified: false }, db, env).full, false);
  setFreeEmails(db, { freeEmails: [' ALICE@gmail.com ', 'alice@gmail.com'] });
  assert.deepEqual(db.freeEmails, ['alice@gmail.com']);
  assert.equal(accessOf(alice, db, env).free, true);
  assert.throws(() => setFreeEmails(db, { freeEmails: ['ok@a.com', 'not-an-email'] }), BillingError);
  assert.deepEqual(db.freeEmails, ['alice@gmail.com']);
});

test('결제는 서버가 저장한 주문 금액과 같을 때만 승인하고, 두 번 와도 한 번만 승인한다', async () => {
  const db = emptyDb();
  const order = createOrder(alice, db, env);
  assert.equal(order.amount, 9900);
  await assert.rejects(confirmPayment(alice, { paymentKey: 'pk', orderId: order.orderId, amount: 100 }, db, env, tossOk), /금액/);
  await assert.rejects(confirmPayment({ ...alice, uid: 'other' }, { paymentKey: 'pk', orderId: order.orderId, amount: 9900 }, db, env, tossOk), /주문/);
  let calls = 0;
  const counted = async () => { calls++; return tossOk(); };
  assert.equal((await confirmPayment(alice, { paymentKey: 'pk', orderId: order.orderId, amount: 9900 }, db, env, counted)).paid, true);
  await confirmPayment(alice, { paymentKey: 'pk', orderId: order.orderId, amount: 9900 }, db, env, counted);
  assert.equal(calls, 1);
  assert.throws(() => createOrder(alice, db, env), /이미/);
});

test('토스가 승인을 거절하면 이용권을 주지 않는다', async () => {
  const db = emptyDb();
  const order = createOrder(alice, db, env);
  const reject = async () => ({ ok: false, status: 400, json: async () => ({ code: 'REJECT_CARD_COMPANY', message: '카드사 거절' }) });
  await assert.rejects(confirmPayment(alice, { paymentKey: 'pk', orderId: order.orderId, amount: 9900 }, db, env, reject), /카드사 거절/);
  assert.equal(accessOf(alice, db, env).paid, false);
  assert.equal(db.orders[order.orderId].status, 'failed');
});
