import { api, refreshAccess } from './account';

// 토스페이먼츠 결제창(API 개별 연동 키, SDK v2). 클라이언트 키는 공개 값이다. 시크릿 키는 서버(.env.local의 TOSS_SECRET_KEY)에만 둔다.
// 배포 번들에는 넣지 않는다 (결제는 아직 로컬 전용)
const CLIENT_KEY: string = import.meta.env.DEV ? import.meta.env.VITE_TOSS_CLIENT_KEY ?? '' : '';

/** 주문을 만들고 토스 결제창을 띄운다. 결제가 끝나면 토스가 /pay/success 또는 /pay/fail 로 보낸다 */
export async function startCheckout(user: { email: string; name: string }) {
  if (!CLIENT_KEY) throw new Error('토스 클라이언트 키가 없습니다 (.env.local의 VITE_TOSS_CLIENT_KEY)');
  const order = await api<{ orderId: string; amount: number; orderName: string; customerKey: string }>('/api/pay/order', { method: 'POST', body: {} });
  const { loadTossPayments } = await import('@tosspayments/tosspayments-sdk');
  const toss = await loadTossPayments(CLIENT_KEY);
  const payment = toss.payment({ customerKey: order.customerKey });
  await payment.requestPayment({
    method: 'CARD',
    amount: { currency: 'KRW', value: order.amount },
    orderId: order.orderId,
    orderName: order.orderName,
    successUrl: `${location.origin}/pay/success`,
    failUrl: `${location.origin}/pay/fail`,
    customerEmail: user.email,
    customerName: user.name,
    card: { useEscrow: false, flowMode: 'DEFAULT', useCardPoint: false, useAppCardOnly: false },
  });
}

/** /pay/success 에서 부른다. 서버가 주문과 금액을 대조한 뒤 승인한다 */
export async function confirmFromUrl(search: string) {
  const q = new URLSearchParams(search);
  await api('/api/pay/confirm', { method: 'POST', body: { paymentKey: q.get('paymentKey'), orderId: q.get('orderId'), amount: Number(q.get('amount')) } });
  await refreshAccess();
}
