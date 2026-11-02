import { useEffect, useRef, useState } from 'react';
import { aiHint } from '../ai/hint';
import { nextHint } from '../engine/hints';
import { useGame, type CurrentHint } from '../engine/state';
import { Box } from '../sketch/components';

/**
 * 우상단 힌트 버튼. 처음 열면 AI가 지금 진행 상황을 읽고 다음에 할 일 하나를 권한다.
 * 한 번 받은 힌트는 창을 닫았다 열어도 그대로 남는다 (2026-10-17). 새 힌트는 ‘새 힌트 받기’를 눌러야 나온다.
 * 먼저 방향을 보여 주고, ‘더 자세히’를 누르면 바로 할 수 있는 행동을 보여 준다.
 * 무엇을 다음 목표로 삼을지는 엔진(nextHint)이 정하고, AI는 플레이어가 이미 한 일을 보고 말을 짓는다.
 * AI에 닿지 못하면 엔진이 정해 둔 문장을 보여 준다.
 */
export function HintButton({ open: controlledOpen, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const ctx = useGame();
  const { state, dispatch } = ctx;
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => { setLocalOpen(next); onOpenChange?.(next); };
  const [loading, setLoading] = useState(false);
  const hint = state.hintCurrent ?? null;
  const ref = useRef<HTMLDivElement>(null);
  const call = useRef(0);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  async function ask() {
    const s = ctx.getState();
    const step = nextHint(new Set(s.owned), new Set(s.done), s.team.jobs, s.unseen);
    const id = ++call.current;
    setLoading(true);
    dispatch({ type: 'hint', key: step.key });
    let h: CurrentHint;
    try {
      h = { ...(await aiHint(s, step)), key: step.key };
    } catch (e) {
      if (import.meta.env?.DEV) console.warn('[힌트 실패]', e);
      h = { title: step.title, hint: step.levels[0], detail: step.levels[1] ?? step.levels[0], key: step.key, local: true };
    }
    if (id !== call.current) return;
    dispatch({ type: 'hintSet', hint: h });
    setLoading(false);
    if (!h.local) dispatch({ type: 'hintNote', note: { at: Date.now(), title: h.title, hint: h.hint, detail: h.detail, key: h.key } });
  }

  const toggle = () => {
    const next = !open;
    setOpen(next);
    // 처음 열 때만 묻는다. 받은 힌트가 있으면 그대로 보여 준다
    if (next && !hint && !loading) void ask();
  };

  return (
    <div className="hint" ref={ref}>
      <Box as="button" className="btn" seed={`hint${open}`} mode={open ? 'double' : 'single'} title="막혔을 때 다음 실마리" onClick={toggle}>
        힌트
      </Box>
      {open && (
        <Box mode="double" className="hint-panel card" seed="hint-panel">
          <div className="hint-hd">
            <span>힌트</span>
            {hint && !loading && <span className="code">{hint.title}</span>}
          </div>
          {loading || !hint
            ? <p className="hint-loading">수사 수첩을 넘겨 보는 중…</p>
            : (
              <ol className="hint-levels">
                <li>{hint.hint}</li>
                {hint.detailShown && <li>{hint.detail}</li>}
              </ol>
            )}
          {hint && !loading && (
            <div className="hint-foot">
              {!hint.detailShown && (
                <Box as="button" className="btn small" seed="hint-more" onClick={() => { dispatch({ type: 'hintSet', hint: { ...hint, detailShown: true } }); dispatch({ type: 'hint', key: hint.key }); }}>더 자세히</Box>
              )}
              <Box as="button" className="btn small" seed="hint-refresh" title="지금 진행 상황으로 새 힌트를 받는다" onClick={() => void ask()}>↻ 새 힌트 받기</Box>
            </div>
          )}
        </Box>
      )}
    </div>
  );
}
