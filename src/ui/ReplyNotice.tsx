import { useEffect } from 'react';
import { ArtIcon } from './ArtIcon';
import { PERSONS } from '../data/case';
import { plain } from '../data/clues';
import { useGame } from '../engine/state';
import { Box, Portrait } from '../sketch/components';
import { NOTICE_MS } from './TeamView';

/**
 * 용의자 답변 도착 알림. 답을 기다리는 동안 다른 화면으로 옮겼으면 수사팀 결과처럼 오른쪽 위에 뜬다.
 * 바로 보기를 누르면 그 사람 대화창을 연다. 다른 창을 보고 있으면 브라우저 탭 제목에도 표시한다.
 */
export function ReplyNotice() {
  const { state, dispatch } = useGame();
  const n = state.replyNotice;
  useEffect(() => {
    if (!n || !document.hidden) return;
    const base = document.title;
    let on = false;
    const id = window.setInterval(() => { on = !on; document.title = on ? `● ${PERSONS[n.person].name} 답변 도착` : base; }, 1000);
    const stop = () => { window.clearInterval(id); document.title = base; };
    document.addEventListener('visibilitychange', stop, { once: true });
    return stop;
  }, [n]);
  // 1분이 지나면 저절로 닫는다 (왼쪽 목록의 "답변 도착" 표시는 대화창을 열 때까지 남는다)
  useEffect(() => {
    if (!n) return;
    const id = window.setTimeout(() => dispatch({ type: 'replyNotice', notice: null }), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [n, dispatch]);
  if (!n || state.screen !== 'hub') return null;
  const p = PERSONS[n.person];
  const close = () => dispatch({ type: 'replyNotice', notice: null });
  const preview = plain(n.text).replace(/\s+/g, ' ');
  return (
    // 수사팀 알림이 떠 있으면 그 아래에 쌓는다
    <Box key={n.id} mode="double" className={`team-notice reply-notice card ${state.notice ? 'stacked' : ''}`} seed={`reply${n.id}`} role="alert">
      <div className="tn-head"><Portrait person={n.person} w={24} h={29} /><span>{p.name} · 답변 도착</span><button className="x" title="닫기" onClick={close}><ArtIcon name="close" size={12} /></button></div>
      <div className="rn-text">“{preview.length > 70 ? `${preview.slice(0, 70)}…` : preview}”</div>
      <div className="tn-acts">
        <Box as="button" className="btn small" seed="rn-later" onClick={close}>나중에 보기</Box>
        <Box as="button" mode="double" className="btn small" seed="rn-open" onClick={() => dispatch({ type: 'openTab', tab: { type: 'person', ref: n.person } })}>바로 보기</Box>
      </div>
    </Box>
  );
}
