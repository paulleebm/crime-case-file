import { useEffect, useState } from 'react';
import guardArt from '../assets/illustrations/guard-screen.webp';
import { InkStamp } from '../sketch/components';

/** 게임 화면이 무너지지 않는 최소 크기 (body min-width와 맞춘다). 2026-10-16: 가로 720부터 진행할 수 있게 넓혔다 */
const MIN_W = 720;
const MIN_H = 460;

function measure() {
  return { w: window.innerWidth, h: window.innerHeight };
}

export function screenTooSmall({ w, h }: { w: number; h: number }) {
  return w < MIN_W || h < MIN_H;
}

/** 브라우저 전체화면으로 바꾼다. 막혀 있거나 이미 전체화면이면 조용히 넘어간다 */
export function enterFullscreen() {
  const el = document.documentElement;
  if (document.fullscreenElement || !el.requestFullscreen) return;
  el.requestFullscreen().catch(() => {});
}

/** PC에서 창이 너무 작거나 비율이 맞지 않으면 게임 위를 덮고 진행을 막는다. 창을 키우면 바로 사라진다 */
export default function ScreenGuard() {
  const [size, setSize] = useState(measure);
  useEffect(() => {
    const on = () => setSize(measure());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  if (!screenTooSmall(size)) return null;
  return (
    <div className="mobile-block screen-guard" role="alertdialog" aria-modal="true">
      <div className="mobile-block-card">
        <img className="guard-art" src={guardArt} alt="" />
        <InkStamp className="mobile-block-stamp">화면 크기</InkStamp>
        <h1>지금 화면 크기에서는<br />진행할 수 없습니다</h1>
        <p>
          브라우저 창을 최대화하거나 전체화면으로 바꿔 주세요.
          <br />
          화면 확대 비율이 크다면 Ctrl + -로 줄여 주세요.
        </p>
        <p className="screen-guard-size mono">
          지금 {size.w} × {size.h}
          <br />
          필요 {MIN_W} × {MIN_H} 이상
        </p>
        <button className="btn screen-guard-btn" onClick={enterFullscreen}>전체화면으로 전환</button>
      </div>
    </div>
  );
}
