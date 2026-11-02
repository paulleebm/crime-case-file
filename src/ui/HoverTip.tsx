import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * 마우스를 올리면 전체 글을 띄워 보여 준다 (근거 트레이·첨부한 근거는 늘 줄여 보이므로 무슨 근거였는지 잊기 쉽다).
 * 화면 맨 위에 그려서 목록의 스크롤·잘림에 가리지 않는다.
 */
export function HoverTip({ tip, children, className, as: Tag = 'span', ...rest }: { tip: ReactNode; children: ReactNode; className?: string; as?: 'span' | 'div' } & Record<string, unknown>) {
  const ref = useRef<HTMLElement | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    // 아래 공간이 넉넉하면 아래에, 아니면 위에
    const below = r.bottom + 180 < window.innerHeight;
    setAt({ x: Math.min(Math.max(12, r.left), window.innerWidth - 352), y: below ? r.bottom + 6 : r.top - 6, below });
  };
  return (
    <Tag ref={ref as never} className={className} onMouseEnter={show} onMouseLeave={() => setAt(null)} onDragStart={() => setAt(null)} {...rest}>
      {children}
      {at && createPortal(
        <div className="hover-tip" role="tooltip" style={{ left: at.x, top: at.y, transform: at.below ? undefined : 'translateY(-100%)' }}>{tip}</div>,
        document.body,
      )}
    </Tag>
  );
}
