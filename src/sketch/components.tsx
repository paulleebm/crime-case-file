import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import { arc, boxStrokes, hashSeed, line, rng, type Stroke } from './sketch';
import solvedSeal from '../assets/ui/seal-solved.webp';
import confirmedSeal from '../assets/ui/seal-confirmed.webp';
import unsolvedSeal from '../assets/ui/seal-unsolved.webp';
import wrongSeal from '../assets/ui/seal-wrong.webp';
import witnessStamp from '../assets/ui/stamp-witness.webp';

export function PencilDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <filter id="pencil" x="-10%" y="-10%" width="120%" height="120%">
        <feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves={2} seed={3} result="warp" />
        <feDisplacementMap in="SourceGraphic" in2="warp" scale={1.4} xChannelSelector="R" yChannelSelector="G" result="wobble" />
        <feTurbulence type="fractalNoise" baseFrequency="1.8 .9" numOctaves={2} seed={11} result="grain" />
        <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -2 0 0 0 1.9" result="grainAlpha" />
        <feComposite in="wobble" in2="grainAlpha" operator="in" />
      </filter>
    </svg>
  );
}

export function Ink({ strokes, clip }: { strokes: Stroke[]; clip?: string }) {
  return (
    <g filter="url(#pencil)" clipPath={clip ? `url(#${clip})` : undefined}>
      {strokes.map((s, i) => (
        <path key={i} d={s.d} strokeWidth={s.w.toFixed(2)} opacity={s.op.toFixed(2)} strokeDasharray={s.dash} fill="none" />
      ))}
    </g>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize((s) => (s.w === el.offsetWidth && s.h === el.offsetHeight ? s : { w: el.offsetWidth, h: el.offsetHeight }));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

type BoxProps = HTMLAttributes<HTMLDivElement> & { mode?: 'single' | 'double' | 'dash'; seed?: string; as?: 'div' | 'button' | 'span'; children?: ReactNode };

/** 연필로 덧그린 테두리가 있는 상자 */
export function Box({ mode = 'single', seed, className, style, children, as = 'div', ...rest }: BoxProps & { type?: string; disabled?: boolean }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const auto = useId();
  const strokes = useMemo(() => (w && h ? boxStrokes(w, h, hashSeed(seed ?? auto), mode) : []), [w, h, seed, auto, mode]);
  const Tag = as as 'div';
  return (
    <Tag ref={ref} className={`sk ${className ?? ''}`} style={style} {...rest}>
      {children}
      {w > 0 && (
        <svg className="sk-svg" width={w} height={h} aria-hidden="true">
          <Ink strokes={strokes} />
        </svg>
      )}
    </Tag>
  );
}

export function Seal({ text, size = 30, style }: { text: string; size?: number; style?: CSSProperties }) {
  const art = ({ 해결: solvedSeal, 확인: confirmedSeal, 미해결: unsolvedSeal, 오인: wrongSeal } as Record<string, string>)[text] ?? confirmedSeal;
  return (
    <span className="seal seal-ink" style={{ width: size, height: size, '--seal-art': `url("${art}")`, ...style } as CSSProperties}>
      {text}
      <span className="seal-impression" aria-hidden="true" />
    </span>
  );
}

export function InkStamp({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return <span className={`ink-stamp ${className}`} style={{ '--witness-art': `url("${witnessStamp}")`, ...style } as CSSProperties}>{children}<span className="seal-impression" aria-hidden="true" /></span>;
}

/** 초상화는 portrait.tsx (사진처럼 그린 증명사진) */
export { Portrait } from './portrait';

/** 체크 표시 */
export function Check({ on }: { on: boolean }) {
  const strokes = useMemo(() => {
    const out: Stroke[] = [];
    const r = rng(9);
    if (on) {
      line(out, r, 3, 8, 7, 13, { os: 1, w: 1.4 });
      line(out, r, 7, 13, 14, 2, { os: 1, w: 1.4 });
    }
    return out;
  }, [on]);
  return (
    <Box as="span" className="check" seed="check">
      <svg className="sk-svg" width={16} height={16} aria-hidden="true"><Ink strokes={strokes} /></svg>
    </Box>
  );
}

/** 채점용 빨간 연필 표시. 부모(position: relative)를 덮는다 */
export function RedMark({ kind, seed }: { kind: 'circle' | 'strike' | 'check' | 'cross' | 'triangle'; seed: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [{ w, h }, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const strokes = useMemo(() => {
    const out: Stroke[] = [];
    if (!w || !h) return out;
    const r = rng(hashSeed('red' + seed + kind));
    const o = { w: 1.8, passes: 2, op: 1 };
    if (kind === 'circle') arc(out, r, w / 2, h / 2, w / 2 + 4, -Math.PI * 0.6, Math.PI * 1.45, { ...o, os: 10, sy: (h / 2 + 5) / (w / 2 + 4) });
    if (kind === 'strike') { line(out, r, 2, h * 0.62, w - 2, h * 0.42, { ...o, os: 6 }); line(out, r, 2, h * 0.7, w - 2, h * 0.5, { ...o, os: 4, passes: 1 }); }
    if (kind === 'check') { line(out, r, w * 0.15, h * 0.55, w * 0.4, h * 0.85, { ...o, os: 2 }); line(out, r, w * 0.4, h * 0.85, w * 0.9, h * 0.1, { ...o, os: 3 }); }
    if (kind === 'triangle') { line(out, r, w / 2, -2, w + 2, h + 2, { ...o, os: 3 }); line(out, r, w + 2, h + 2, -2, h + 2, { ...o, os: 3 }); line(out, r, -2, h + 2, w / 2 + 1, -1, { ...o, os: 3 }); }
    if (kind === 'cross') { line(out, r, w * 0.15, h * 0.15, w * 0.85, h * 0.85, { ...o, os: 3 }); line(out, r, w * 0.85, h * 0.15, w * 0.15, h * 0.85, { ...o, os: 3 }); }
    return out;
  }, [w, h, kind, seed]);
  return (
    <span ref={ref} className={`redmark ${kind}`} aria-hidden="true">
      {w > 0 && <svg className="sk-svg" width={w} height={h}><Ink strokes={strokes} /></svg>}
    </span>
  );
}
