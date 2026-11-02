import mobileArt from '../assets/illustrations/mobile-block.webp';
import { InkStamp } from '../sketch/components';

/** 휴대폰·태블릿 접속 판별. 화면 폭이 아니라 기기 종류로 본다 (viewport가 1440으로 고정돼 있어서) */
export function isMobileDevice(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Opera Mini|IEMobile/i.test(ua)) return true;
  // iPadOS는 데스크톱 Safari처럼 자신을 Macintosh로 밝힌다. 터치 지점 수로 가려낸다
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

/** 모바일 접속 시 게임 대신 보여주는 안내. 게임 화면은 아예 그리지 않는다 */
export default function MobileBlock() {
  return (
    <div className="mobile-block">
      <div className="mobile-block-card">
        <img className="guard-art" src={mobileArt} alt="" />
        <InkStamp className="mobile-block-stamp">PC 전용</InkStamp>
        <h1>미해결 사건 파일</h1>
        <p>
          원활한 게임 진행을 위해 PC 환경에서 접속해 주세요.
          <br />
          이 게임은 넓은 화면과 마우스 조작을 기준으로 만들어졌습니다.
        </p>
        <p className="mobile-block-url mono">crime-case-file.web.app</p>
      </div>
    </div>
  );
}
