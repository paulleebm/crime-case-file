import { useEffect, useState, type ReactNode } from 'react';
import { Box } from '../sketch/components';
import { PAYWALL_ON, refreshAccess, signInWithGoogle, signOutAccount, useAccount } from './account';
import { confirmFromUrl, startCheckout } from './pay';

const won = (n: number) => `${n.toLocaleString('ko-KR')}원`;

function errText(e: unknown) {
  const err = e as { code?: string; message?: string };
  if (err.code === 'auth/popup-closed-by-user' || err.code === 'auth/cancelled-popup-request') return '';
  if (err.code === 'auth/operation-not-allowed') return 'Firebase 콘솔에서 Google 로그인을 켜 주세요.';
  if (err.code === 'auth/unauthorized-domain') return '이 주소가 Firebase 승인 도메인에 없습니다.';
  return err.message ?? String(e);
}

/** 사건 고르기 화면 위쪽: 로그인 상태 */
export function AccountBar() {
  if (!PAYWALL_ON) return null;
  return <AccountBarInner />;
}

function AccountBarInner() {
  const acc = useAccount();
  const [error, setError] = useState('');
  if (acc.status === 'loading') return <div className="account-bar muted">로그인 확인 중…</div>;
  if (acc.status === 'signed-out') {
    return (
      <div className="account-bar">
        <button className="btn small" onClick={() => signInWithGoogle().then(() => setError(''), (e) => setError(errText(e)))}>Google로 로그인</button>
        {error && <span className="account-error">{error}</span>}
      </div>
    );
  }
  const a = acc.access;
  const badge = !a ? '' : a.admin ? '관리자' : a.free ? '무료 이용' : a.paid ? '이용권 보유' : '';
  return (
    <div className="account-bar">
      <span className="account-email">{acc.user.email}</span>
      {badge && <span className="stamp-box account-badge">{badge}</span>}
      {a?.admin && <a className="btn small" href="/bymile">관리자</a>}
      <button className="btn small" onClick={() => void signOutAccount()}>로그아웃</button>
    </div>
  );
}

/**
 * 사건 카드의 버튼 자리. 이용권이 있으면 children(수사 시작·이어서 하기)을 그대로 보여 주고,
 * 없으면 로그인·구매 버튼을 보여 준다.
 */
export function EpisodeGate({ children }: { children: ReactNode }) {
  if (!PAYWALL_ON) return <>{children}</>;
  return <EpisodeGateInner>{children}</EpisodeGateInner>;
}

function EpisodeGateInner({ children }: { children: ReactNode }) {
  const acc = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (acc.status === 'signed-in' && acc.access?.full) return <>{children}</>;
  const run = (f: () => Promise<unknown>) => {
    setBusy(true); setError('');
    f().catch((e) => setError(errText(e))).finally(() => setBusy(false));
  };
  let body: ReactNode;
  if (acc.status === 'loading' || (acc.status === 'signed-in' && !acc.access && !acc.error)) {
    body = <span className="muted">이용권 확인 중…</span>;
  } else if (acc.status === 'signed-out') {
    body = (
      <>
        <p className="paywall-text">{'사건 수사는 Google로 로그인한 뒤 전체 이용권으로 열 수 있습니다.'}</p>
        <Box as="button" mode="double" className="btn" seed="b-login" disabled={busy} onClick={() => run(signInWithGoogle)}>Google로 로그인</Box>
      </>
    );
  } else if (!acc.access) {
    body = (
      <>
        <p className="paywall-text">이용권 상태를 불러오지 못했습니다.</p>
        <Box as="button" className="btn" seed="b-retry" onClick={() => void refreshAccess()}>다시 확인</Box>
      </>
    );
  } else {
    const { user, access } = acc;
    body = (
      <>
        <p className="paywall-text">{`전체 이용권은 한 번만 결제합니다.\n지금 사건과 앞으로 열리는 사건을 모두 플레이할 수 있습니다.`}</p>
        <Box as="button" mode="double" className="btn" seed="b-buy" disabled={busy} onClick={() => run(() => startCheckout(user))}>
          {busy ? '결제창 여는 중…' : `전체 이용권 구매 · ${won(access.price)}`}
        </Box>
      </>
    );
  }
  return (
    <div className="paywall">
      {body}
      {error && <div className="account-error">{error}</div>}
    </div>
  );
}

/** 이용권 없이 사건 화면에 들어왔을 때 (저장 불러오기 등) */
export function PaywallScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="center-screen">
      <Box mode="double" className="card paywall-card" seed="paywall">
        <h2>이용권이 필요합니다</h2>
        <EpisodeGate>{null}</EpisodeGate>
        <button className="btn small" onClick={onBack}>← 사건 목록</button>
      </Box>
    </div>
  );
}

/** /pay/success, /pay/fail: 토스 결제창이 돌려보내는 곳 */
export function PayResult({ ok }: { ok: boolean }) {
  const acc = useAccount();
  const q = new URLSearchParams(location.search);
  const [phase, setPhase] = useState<'wait' | 'done' | 'error'>(ok ? 'wait' : 'error');
  const [message, setMessage] = useState(ok ? '' : q.get('message') ?? '결제를 취소했거나 실패했습니다.');
  const ready = acc.status !== 'loading';
  useEffect(() => {
    if (!ok || !ready) return;
    if (acc.status === 'signed-out') { setPhase('error'); setMessage('로그인이 풀려 결제를 확인하지 못했습니다. 다시 로그인한 뒤 이 주소를 새로고침해 주세요.'); return; }
    confirmFromUrl(location.search).then(() => setPhase('done'), (e) => { setPhase('error'); setMessage((e as Error).message); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ok, ready]);
  const back = () => location.replace('/?view=episodes');
  return (
    <div className="center-screen">
      <Box mode="double" className="card paywall-card" seed="pay-result">
        {phase === 'wait' && <h2>결제를 확인하고 있습니다…</h2>}
        {phase === 'done' && <><h2>결제가 끝났습니다</h2><p className="paywall-text">{'전체 이용권이 열렸습니다.\n이제 모든 사건을 수사할 수 있습니다.'}</p></>}
        {phase === 'error' && <><h2>결제가 완료되지 않았습니다</h2><p className="paywall-text">{message}</p></>}
        {phase !== 'wait' && <Box as="button" mode="double" className="btn" seed="pay-back" onClick={back}>사건 목록으로</Box>}
      </Box>
    </div>
  );
}
