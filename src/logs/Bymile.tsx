import { lazy, Suspense, useEffect, useState } from 'react';
import { PAYWALL_ON } from '../account/account';

// 운영자 화면 (/bymile): 이용권 관리(무료 이메일·결제)와 플레이 기록 열람을 탭으로 묶는다.
const AdminPage = lazy(() => import('../account/AdminPage'));
const LogViewer = lazy(() => import('./LogViewer'));

type Tab = 'billing' | 'logs';
const TAB_KEY = 'bymile-tab';
const TITLE: Record<Tab, string> = { billing: '이용권 관리', logs: '플레이 기록' };

export default function Bymile() {
  // 결제가 꺼진 배포에서는 플레이 기록만 보여 준다
  if (!PAYWALL_ON) return <Suspense fallback={null}><LogViewer /></Suspense>;
  return <Tabs />;
}

function Tabs() {
  const [tab, setTab] = useState<Tab>(() => { try { return localStorage.getItem(TAB_KEY) === 'logs' ? 'logs' : 'billing'; } catch { return 'billing'; } });
  useEffect(() => {
    document.title = `${TITLE[tab]} · 운영자`;
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* noop */ }
  }, [tab]);
  return (
    <>
      <nav className="bymile-tabs">
        {(Object.keys(TITLE) as Tab[]).map((t) => (
          <button key={t} className={`bymile-tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{TITLE[t]}</button>
        ))}
        <span className="grow" />
        <a className="bymile-tab" href="/?view=episodes">← 게임</a>
      </nav>
      <Suspense fallback={null}>{tab === 'billing' ? <AdminPage /> : <LogViewer />}</Suspense>
    </>
  );
}
