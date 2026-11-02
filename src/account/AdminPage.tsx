import { useEffect, useState } from 'react';
import { Box, PencilDefs } from '../sketch/components';
import { api, signInWithGoogle, signOutAccount, useAccount } from './account';

// 관리자 화면 (/bymile의 '이용권 관리' 탭). 무료로 쓸 이메일을 정하고 결제 기록을 본다.
// 관리자는 .env.local의 ADMIN_EMAILS 에 적은 Google 계정이다. 서버가 매 요청마다 확인한다.

interface AdminData {
  freeEmails: string[];
  purchases: { uid: string; email: string; orderId: string; amount: number; method?: string; at: string }[];
  orders: { orderId: string; email: string; amount: number; status: string; createdAt: string; error?: string }[];
}

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;
const when = (s: string) => new Date(s).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const STATUS: Record<string, string> = { ready: '결제 전', done: '완료', failed: '실패' };

export default function AdminPage() {
  const acc = useAccount();
  const [data, setData] = useState<AdminData | null>(null);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const isAdmin = acc.status === 'signed-in' && acc.access?.admin;

  useEffect(() => {
    if (!isAdmin) return;
    api<AdminData>('/api/admin').then(setData, (e) => setError((e as Error).message));
  }, [isAdmin]);

  const save = (freeEmails: string[]) => {
    setBusy(true); setError('');
    api<AdminData>('/api/admin', { method: 'POST', body: { freeEmails } })
      .then((d) => { setData(d); setInput(''); }, (e) => setError((e as Error).message))
      .finally(() => setBusy(false));
  };
  const add = () => {
    const more = input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (data && more.length) save([...data.freeEmails, ...more]);
  };

  let body;
  if (acc.status === 'loading') body = <p className="muted">로그인 확인 중…</p>;
  else if (acc.status === 'signed-out') body = <button className="btn" onClick={() => void signInWithGoogle().catch(() => {})}>Google로 로그인</button>;
  else if (!acc.access) body = <p className="muted">{acc.error ?? '권한 확인 중…'}</p>;
  else if (!acc.access.admin) {
    body = <p>{`${acc.user.email} 계정은 관리자가 아닙니다.\n.env.local의 ADMIN_EMAILS에 이 이메일을 넣으면 들어올 수 있습니다.`}</p>;
  } else {
    body = (
      <>
        <section>
          <h2>무료 이메일 <span className="code">{data?.freeEmails.length ?? 0}</span></h2>
          <p className="muted">{'여기 있는 Google 계정은 결제 없이 모든 사건을 플레이합니다.\n쉼표나 줄바꿈으로 여러 개를 한 번에 넣을 수 있습니다.'}</p>
          <div className="admin-add">
            <textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder="friend@gmail.com" rows={2}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }} />
            <button className="btn" disabled={busy || !data || !input.trim()} onClick={add}>추가</button>
          </div>
          <ul className="admin-list">
            {data?.freeEmails.map((e) => (
              <li key={e}><span>{e}</span><button className="btn small" disabled={busy} onClick={() => save(data.freeEmails.filter((x) => x !== e))}>빼기</button></li>
            ))}
            {data && !data.freeEmails.length && <li className="muted">아직 없습니다.</li>}
          </ul>
        </section>
        <section>
          <h2>결제한 사람 <span className="code">{data?.purchases.length ?? 0}</span></h2>
          <table className="admin-table">
            <thead><tr><th>이메일</th><th>금액</th><th>수단</th><th>시각</th></tr></thead>
            <tbody>
              {data?.purchases.map((p) => <tr key={p.uid}><td>{p.email}</td><td>{won(p.amount)}</td><td>{p.method ?? ''}</td><td>{when(p.at)}</td></tr>)}
            </tbody>
          </table>
        </section>
        <section>
          <h2>최근 주문</h2>
          <table className="admin-table">
            <thead><tr><th>주문</th><th>이메일</th><th>금액</th><th>상태</th><th>시각</th></tr></thead>
            <tbody>
              {data?.orders.map((o) => <tr key={o.orderId} title={o.error}><td className="code">{o.orderId}</td><td>{o.email}</td><td>{won(o.amount)}</td><td>{STATUS[o.status] ?? o.status}</td><td>{when(o.createdAt)}</td></tr>)}
            </tbody>
          </table>
        </section>
      </>
    );
  }

  return (
    <div className="admin-page">
      <PencilDefs />
      <Box mode="double" className="card admin-card" seed="admin">
        <div className="admin-head">
          <h1>이용권 관리</h1>
          <div className="account-bar">
            {acc.status === 'signed-in' && <><span className="account-email">{acc.user.email}</span><button className="btn small" onClick={() => void signOutAccount()}>로그아웃</button></>}
          </div>
        </div>
        {error && <p className="account-error">{error}</p>}
        {body}
      </Box>
    </div>
  );
}
