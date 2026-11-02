import { useEffect, useRef, useState } from 'react';
import { useGame } from '../engine/state';
import { Box } from '../sketch/components';

/**
 * 메모장 탭 (2026-10-17). 그냥 적어 두는 종이다. 게임은 이 글을 읽거나 채점하지 않는다.
 * 글을 골라 끌면 심문·수사팀 입력칸에 그대로 놓인다. 끌어도 메모장의 글은 지워지지 않는다(복사).
 */
export function NotepadView() {
  const { state, dispatch } = useGame();
  const [text, setText] = useState(state.notepad ?? '');
  const latest = useRef(text);
  latest.current = text;
  // 쓰는 동안 매번 저장하지 않고 잠깐 멈추면 저장한다. 탭을 닫거나 옮길 때도 마지막 글을 남긴다
  useEffect(() => {
    const id = window.setTimeout(() => dispatch({ type: 'notepad', text }), 400);
    return () => window.clearTimeout(id);
  }, [text, dispatch]);
  useEffect(() => () => dispatch({ type: 'notepad', text: latest.current }), [dispatch]);

  return (
    <div className="docview notepad">
      <h3 className="doc-title">메모장</h3>
      <div className="doc-meta">자유롭게 적어 두는 곳이다. 글을 골라 끌면 대화 입력칸에 놓을 수 있다.</div>
      <Box mode="single" seed="notepad" className="inputbox notepad-box">
        <textarea
          className="notepad-text"
          value={text}
          placeholder="시각, 이름, 의심 가는 점을 적어 두자."
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { if (text !== (state.notepad ?? '')) dispatch({ type: 'notepad', text }); }}
          // 끌어 가도 메모장의 글은 남는다 (기본 동작은 잘라 내기)
          onDragStart={(e) => { e.dataTransfer.effectAllowed = 'copy'; }}
        />
      </Box>
    </div>
  );
}
