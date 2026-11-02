import { useEffect } from 'react';
import { useGame } from './engine/state';
import { PencilDefs } from './sketch/components';
import { Briefing, Episodes, Title } from './ui/Title';
import { Hub } from './ui/Hub';
import { Afterword, Epilogue, Result } from './ui/Result';
import { Toast } from './ui/common';
import ScreenGuard from './ui/ScreenGuard';
import { PAYWALL_ON, useAccount } from './account/account';
import { PaywallScreen } from './account/AccountUI';

/** 이용권이 있어야 들어가는 사건 화면 */
const PAID_SCREENS = new Set(['briefing', 'hub', 'result', 'epilogue', 'afterword']);

export default function App() {
  const { state, dispatch } = useGame();
  const account = useAccount();
  useEffect(() => {
    if (new URLSearchParams(location.search).get('view') === 'episodes') {
      dispatch({ type: 'screen', screen: 'episodes' });
      history.replaceState(null, '', location.pathname);
    }
  }, [dispatch]);
  useEffect(() => {
    // 게임에서 정한 항목(탭, 자료, 근거 클립 등)만 끌 수 있게 하고, 글자·그림의 기본 드래그는 막는다
    const guard = (e: DragEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (!el?.closest('[draggable="true"]')) e.preventDefault();
    };
    document.addEventListener('dragstart', guard);
    return () => document.removeEventListener('dragstart', guard);
  }, []);
  // 저장 불러오기 등으로 이용권 없이 사건 화면에 들어오면 막는다. 확인 중에는 아무것도 그리지 않는다
  if (PAYWALL_ON && PAID_SCREENS.has(state.screen)) {
    const full = account.status === 'signed-in' && account.access?.full;
    const checking = account.status === 'loading' || (account.status === 'signed-in' && !account.access && !account.error);
    if (!full) {
      return checking ? null : (
        <>
          <PencilDefs />
          <PaywallScreen onBack={() => dispatch({ type: 'screen', screen: 'episodes' })} />
        </>
      );
    }
  }
  return (
    <>
      <PencilDefs />
      {state.screen === 'title' && <Title />}
      {state.screen === 'episodes' && <Episodes />}
      {state.screen === 'briefing' && <Briefing />}
      {state.screen === 'hub' && <Hub />}
      {state.screen === 'result' && <Result />}
      {state.screen === 'epilogue' && <Epilogue />}
      {state.screen === 'afterword' && <Afterword />}
      <Toast />
      <ScreenGuard />
    </>
  );
}
