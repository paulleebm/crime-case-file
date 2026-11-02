import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * 연필 획 모양의 입력 커서. 브라우저 커서는 색만 바꿀 수 있어서, 기본 커서를 숨기고(caret-color: transparent) 이 커서를 입력 위치에 그린다.
 * 입력 위치는 같은 글꼴·폭의 보이지 않는 거울 상자에 앞쪽 글자를 넣어 잰다. 한글 조합 중에도 선택 위치를 따라간다.
 * 글자를 고르는 중(범위 선택)이거나 포커스가 없으면 감춘다. 움직일 때마다 깜빡임을 처음부터 다시 시작한다.
 * 감싼 상자는 position: relative 여야 한다.
 */
export function PencilCaret({ target }: { target: RefObject<HTMLTextAreaElement | null> }) {
  const [pos, setPos] = useState<{ top: number; left: number; height: number } | null>(null);
  const [tick, setTick] = useState(0);
  const mirror = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const ta = target.current;
    if (!ta) return;
    const measure = () => {
      if (document.activeElement !== ta || ta.selectionStart !== ta.selectionEnd) { setPos(null); return; }
      const cs = getComputedStyle(ta);
      const m = (mirror.current ??= document.createElement('div'));
      for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'borderRightWidth', 'boxSizing', 'wordSpacing', 'textIndent', 'wordBreak', 'overflowWrap', 'whiteSpace', 'tabSize'] as const) (m.style as unknown as Record<string, string>)[k] = cs[k] as string;
      Object.assign(m.style, { position: 'absolute', visibility: 'hidden', top: '0', left: '-9999px', width: `${ta.clientWidth}px`, borderStyle: 'solid', borderColor: 'transparent' });
      if (!m.isConnected) document.body.appendChild(m);
      m.textContent = ta.value.slice(0, ta.selectionStart);
      const mark = document.createElement('span');
      mark.textContent = '​';
      m.appendChild(mark);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.5;
      setPos({ top: ta.offsetTop + mark.offsetTop - ta.scrollTop, left: ta.offsetLeft + mark.offsetLeft - ta.scrollLeft, height: lh });
      setTick((t) => t + 1);
    };
    const later = () => requestAnimationFrame(measure);
    const events: (keyof HTMLElementEventMap)[] = ['input', 'keydown', 'keyup', 'click', 'mouseup', 'focus', 'blur', 'scroll', 'compositionupdate', 'compositionend'];
    events.forEach((e) => ta.addEventListener(e, later));
    document.addEventListener('selectionchange', later);
    window.addEventListener('resize', later);
    later();
    return () => {
      events.forEach((e) => ta.removeEventListener(e, later));
      document.removeEventListener('selectionchange', later);
      window.removeEventListener('resize', later);
      mirror.current?.remove();
      mirror.current = null;
    };
  }, [target]);

  if (!pos) return null;
  const h = pos.height * 0.82;
  return (
    <svg
      key={tick}
      className="pencil-caret"
      aria-hidden
      viewBox="0 0 4 20"
      preserveAspectRatio="none"
      style={{ top: pos.top + (pos.height - h) / 2, left: pos.left - 1, height: h }}
    >
      {/* 흑연 획: 위아래가 살짝 가늘고 한쪽으로 기운 짧은 선 + 옅은 덧선 */}
      <path className="lead" d="M2.3 .8C2.1 6 1.9 13 1.6 19.2" />
      <path className="grain" d="M2.8 2.5C2.6 8 2.4 13 2.2 17.5" />
    </svg>
  );
}
