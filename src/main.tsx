import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installAudioUnlock } from './audio/engine';
import { GameProvider } from './engine/state';
import MobileBlock, { isMobileDevice } from './ui/MobileBlock';
import { hasSaveHash } from './engine/saveLink';
import { SaveLinkGate } from './ui/Settings';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

// 운영자 화면: 이용권 관리 + 플레이 기록 열람 (게임과 따로 불러온다)
if (/^\/bymile\/?$/.test(location.pathname)) {
  document.body.classList.add('log-page');
  void import('./logs/Bymile').then(({ default: Bymile }) => root.render(<StrictMode><Bymile /></StrictMode>));
} else if (/^\/pay\/(success|fail)\/?$/.test(location.pathname)) {
  // 토스 결제창이 돌려보내는 곳
  const ok = location.pathname.startsWith('/pay/success');
  void import('./account/AccountUI').then(({ PayResult }) => root.render(<StrictMode><PayResult ok={ok} /></StrictMode>));
} else if (/^\/cold\/?$/.test(location.pathname)) {
  // 미제 사건 수사 게임 뼈대 (cold-case 브랜치, 로컬 테스트용)
  void import('./cold/ColdApp').then(({ default: ColdApp }) => root.render(<StrictMode><ColdApp /></StrictMode>));
} else if (isMobileDevice()) {
  document.body.classList.add('is-mobile');
  root.render(<MobileBlock />);
} else {
  installAudioUnlock();
  const game = (
    <GameProvider>
      <App />
    </GameProvider>
  );
  // 세이브 링크(#save=)로 들어오면 기록을 먼저 확인하고 이 기기에 쓴다
  root.render(<StrictMode>{hasSaveHash() ? <SaveLinkGate>{game}</SaveLinkGate> : game}</StrictMode>);
  // 게임을 켜 둔 탭에 세이브 링크를 붙여 넣으면 # 만 바뀌고 새로 불러오지 않으므로 직접 다시 연다
  addEventListener('hashchange', () => { if (hasSaveHash()) location.reload(); });
}
