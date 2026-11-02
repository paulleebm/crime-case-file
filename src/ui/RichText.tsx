import { clueRef, segments } from '../data/clues';
import { useGame } from '../engine/state';
import { toTray } from './EvidenceTray';

/** 근거 문장. 난이도 설정(밑줄)이 켜져 있으면 밑줄을 긋는다. 정정된 문장은 언제나 두 줄로 긋는다 */
function Clue({ id, text, struck, admitted }: { id: string; text: string; struck?: boolean; admitted?: boolean }) {
  const ctx = useGame();
  const { state } = ctx;
  const show = state.underline !== false && state.owned.includes(clueRef(id));
  if (!show && !struck && !admitted) return <>{text}</>;
  // 밑줄 친 문장을 누르면 근거 트레이에 담긴다 (정정된 문장은 더 쓰지 않는다)
  const collectable = show && !struck;
  const inTray = (state.tray ?? []).includes(id);
  return (
    <span className={`${show ? 'clue' : ''} ${collectable ? 'collect' : ''} ${inTray ? 'in-tray' : ''} ${struck ? 'struck' : ''} ${admitted ? 'admitted' : ''}`}
      title={collectable ? (inTray ? '근거 트레이에 담겨 있다' : '눌러서 근거 트레이에 담기') : admitted ? '근거로 인정받은 사실' : undefined}
      onClick={collectable ? (e) => { e.stopPropagation(); toTray(ctx, id); } : undefined}>{text}</span>
  );
}

/**
 * ⟦ID|문장⟧ 표기를 근거 문장으로 그린다. struck에 든 근거 문장은 정정(두 줄) 처리한다.
 * current이면 정정된 문장은 빼고 지금의 진술만 보여 준다. admitted에 든 문장은 인정받은 사실로 표시한다.
 */
export function RichText({ text, struck, current = false, admitted }: { text: string; struck?: Set<string>; current?: boolean; admitted?: Set<string> }) {
  return (
    <>
      {segments(text)
        .filter((s) => !(current && 'clue' in s && struck?.has(s.clue)))
        .map((s, i) => ('clue' in s ? <Clue key={i} id={s.clue} text={s.text} struck={!current && struck?.has(s.clue)} admitted={current && admitted?.has(s.clue)} /> : <span key={i}>{s.text}</span>))}
    </>
  );
}
