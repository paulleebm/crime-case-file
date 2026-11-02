import { useState } from 'react';
import { BRIEFING, CASE_NO } from '../data/case';
import { EPISODES, GAME_TITLE, GAME_TITLE_EN } from '../data/episodes';
import { clearSave, loadSave, newGame, useGame } from '../engine/state';
import { Box } from '../sketch/components';
import { EpisodeArt, FileStack } from './CoverArt';
import { enterFullscreen } from './ScreenGuard';
import { SettingsMenu } from './Settings';
import { AccountBar, EpisodeGate } from '../account/AccountUI';

/** 게임 표지: 「미해결 사건 파일」 */
export function Title() {
  const { dispatch } = useGame();
  return (
    <div className="center-screen">
      <SettingsMenu />
      <Box mode="double" className="game-cover card" seed="game-cover">
        <div className="gc-top">
          <span className="code">도심경찰서 강력팀 · 보관 기록</span>
          <span className="code">{GAME_TITLE_EN}</span>
        </div>
        <div className="gc-main">
          <div className="gc-text">
            <div className="gc-kicker">다시 펼치는 기록</div>
            <h1 className="gc-title">미해결<br />사건 파일</h1>
            <p className="gc-lead">기록은 남았지만 답은 남지 않은 사건들.<br />진술과 기록 사이의 어긋남을 찾아 다시 맞춰라.</p>
          </div>
          <div className="gc-art">
            <FileStack width={300} />
          </div>
        </div>
        <div className="cover-actions" style={{ justifyContent: 'center' }}>
          <Box as="button" mode="double" className="btn gc-start" seed="b-start" onClick={() => { enterFullscreen(); dispatch({ type: 'screen', screen: 'episodes' }); }}>시작하기</Box>
        </div>
      </Box>
    </div>
  );
}

/** 사건 고르기: 첫 에피소드를 사건명과 정사각형 그림으로 보여 준다 */
export function Episodes() {
  const { dispatch } = useGame();
  const [save] = useState(loadSave);
  const [confirm, setConfirm] = useState(false);
  const [first, ...rest] = EPISODES;
  const start = () => {
    clearSave();
    dispatch({ type: 'load', state: newGame() });
  };
  const resume = () => save && dispatch({ type: 'load', state: { ...save, screen: save.result ? 'result' : save.screen === 'briefing' ? 'briefing' : 'hub' } });
  const started = !!save && save.screen !== 'title' && save.screen !== 'episodes';
  const status = !started ? '새 사건' : save!.result ? (save!.result.grade === 'wrong' ? '오인 종결' : '해결') : '수사 중';
  return (
    <div className="center-screen">
      <div className="episodes">
        <div className="ep-head">
          <button className="btn small ep-back" onClick={() => dispatch({ type: 'screen', screen: 'title' })}>← 표지</button>
          <div className="ep-heading">{GAME_TITLE}</div>
          <span className="code">사건 {EPISODES.filter((e) => e.ready).length} / {EPISODES.length}</span>
        </div>
        <AccountBar />
        <Box mode="double" className="ep-card card" seed="ep-01">
          <div className="ep-art">
            <EpisodeArt name={first.art} size={300} />
            <Box className="ep-no" seed="ep-no-01"><span className="ep-no-k">사건</span>EP.{first.no}</Box>
          </div>
          <div className="ep-info">
            <div className="code">수사 기록 · {first.caseNo} · 예상 플레이타임 약 40~50분</div>
            <h1 className="ep-title">{first.title}</h1>
            <p className="ep-blurb">{first.blurb}</p>
            <div className="ep-status"><span className="stamp-box">{status}</span></div>
            <EpisodeGate>
            <div className="cover-actions">
              {started ? (
                <>
                  <Box as="button" mode="double" className="btn" seed="b-cont" onClick={resume}>이어서 하기</Box>
                  {confirm ? (
                    <Box as="button" className="btn" seed="b-new2" onClick={start}>저장된 수사를 지우고 새로 시작</Box>
                  ) : (
                    <Box as="button" className="btn" seed="b-new" onClick={() => setConfirm(true)}>새로 시작</Box>
                  )}
                </>
              ) : (
                <Box as="button" mode="double" className="btn" seed="b-go" onClick={start}>수사 시작</Box>
              )}
            </div>
            </EpisodeGate>
          </div>
        </Box>
        <div className="ep-more">
          {rest.map((e) => (
            <Box key={e.id} mode="dash" className="ep-mini" seed={`ep-${e.id}`}>
              <EpisodeArt name={e.art} size={64} />
              <div>
                <div className="code">EP.{e.no}</div>
                <div className="ep-mini-title">{e.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{e.subtitle}</div>
              </div>
            </Box>
          ))}
        </div>
      </div>
    </div>
  );
}

export function BriefingText() {
  return (
    <>
      <h2>사 건 개 요</h2>
      <div className="code" style={{ textAlign: 'center', marginBottom: 22 }}>{CASE_NO} · 2026. 10. 14. 09:00 인계</div>
      {BRIEFING.map((p, i) => <p key={i} style={{ whiteSpace: 'pre-line' }}>{p}</p>)}
      <h4 style={{ font: '600 13px var(--ui)', margin: '22px 0 6px' }}>수사 방법</h4>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.9, color: 'var(--ink-2)' }}>
        <li>왼쪽에서 용의자를 누르면 진술서와 대화창이 함께 열립니다. 대화로 진술이 바뀌면 진술서도 정정됩니다.</li>
        <li>원본 기록과 감정은 왼쪽의 수사팀에 말로 요청합니다. 결과는 조사가 끝나야 들어옵니다.</li>
        <li>근거 트레이의 근거를 대화창에 끌어다 놓고 ‘근거 제시’를 누르면 진술과 맞대 볼 수 있습니다.</li>
        <li>준비가 되면 왼쪽 맨 아래의 사건 재구성을 제출합니다.</li>
      </ul>
    </>
  );
}

export function Briefing() {
  const { dispatch } = useGame();
  return (
    <div className="center-screen">
      <Box mode="double" className="brief card" seed="brief">
        <BriefingText />
        <div className="cover-actions" style={{ justifyContent: 'flex-end' }}>
          <Box as="button" mode="double" className="btn" seed="go" onClick={() => dispatch({ type: 'screen', screen: 'hub' })}>수사 본부로</Box>
        </div>
      </Box>
    </div>
  );
}
