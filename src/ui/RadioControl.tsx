import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { audio } from '../audio/engine';
import { STATIONS } from '../audio/stations';
import { Box, Ink } from '../sketch/components';
import { circle, hashSeed, hatch, line, rng, type Stroke } from '../sketch/sketch';

/** 우상단 라디오: 채널 넘기기, 음악·효과음 음량. 음악 음량을 0으로 내리면 라디오가 꺼진다 */
export function RadioControl() {
  const [, force] = useState(0);
  useEffect(() => audio.subscribe(() => force((n) => n + 1)), []);
  const s = audio.settings;
  const st = STATIONS[s.station];
  return (
    <div className="radio">
      <div className="radio-dial">
        <Box as="button" className="btn" seed="rd-prev" title="이전 채널" onClick={() => audio.tune(-1)}>◀</Box>
        <div className="radio-name" title="배경음악 채널">
          <span className="fq">FM {st.freq}{audio.tuning ? ' · 수신 중…' : s.playing ? '' : ' · 꺼짐'}</span>
          <span className="nm">{st.name}</span>
        </div>
        <Box as="button" className="btn" seed="rd-next" title="다음 채널" onClick={() => audio.tune(1)}>▶</Box>
      </div>
      <div className="radio-vol">
        <span className="vol-label">음악</span>
        <PencilSlider label="음악 음량" value={s.music} onChange={(v) => audio.setMusic(v)} />
        <span className="vol-label">효과음</span>
        <PencilSlider label="효과음 음량" value={s.sfx} onChange={(v) => audio.setSfx(v)} />
      </div>
    </div>
  );
}

const W = 84, H = 16, PAD = 6;

/** 연필로 그린 음량 막대. 끌거나 누르거나 화살표 키로 조절한다 */
function PencilSlider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const x = PAD + value * (W - PAD * 2);
  // 레일: 눈금과 빈 레일은 고정, 채운 부분과 손잡이는 값에 따라 다시 그린다
  const rail = useMemo(() => {
    const o: Stroke[] = [];
    const r = rng(hashSeed(`rail-${label}`));
    line(o, r, PAD, H / 2, W - PAD, H / 2, { os: 1.5, w: 0.7, op: 0.55, j: 0.4 });
    for (let k = 0; k <= 4; k++) {
      const tx = PAD + (k / 4) * (W - PAD * 2);
      line(o, r, tx, H / 2 + 3, tx, H / 2 + (k % 2 ? 5 : 6.5), { os: 0, w: 0.5, op: 0.6, passes: 1, j: 0.2 });
    }
    return o;
  }, [label]);
  const fill = useMemo(() => {
    const o: Stroke[] = [];
    const r = rng(hashSeed(`fill-${label}`));
    if (x - PAD > 1) {
      line(o, r, PAD, H / 2, x, H / 2, { os: 0.5, w: 1.6, passes: 3, j: 0.5 });
      hatch(o, r, PAD, H / 2 - 2.5, x - PAD, 5, 2.4, { op: 0.45 });
    }
    circle(o, r, x, H / 2, 4.2, { os: 2, w: 1.1 });
    return o;
  }, [label, x]);

  const setFrom = (clientX: number) => {
    const rect = ref.current!.getBoundingClientRect();
    const v = (clientX - rect.left - PAD * (rect.width / W)) / (rect.width - (PAD * 2 * rect.width) / W);
    onChange(Math.round(Math.min(1, Math.max(0, v)) * 100) / 100);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => { e.currentTarget.setPointerCapture(e.pointerId); setFrom(e.clientX); };
  const onMove = (e: PointerEvent<HTMLDivElement>) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) setFrom(e.clientX); };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : e.key === 'Home' ? -1 : e.key === 'End' ? 1 : 0;
    if (!step) return;
    e.preventDefault();
    onChange(Math.round(Math.min(1, Math.max(0, value + step)) * 100) / 100);
  };

  return (
    <div
      ref={ref}
      className="pencil-slider"
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      title={`${label} ${Math.round(value * 100)}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onKeyDown={onKey}
    >
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" style={{ display: 'block', overflow: 'visible' }}>
        <Ink strokes={rail} />
        <Ink strokes={fill} />
      </svg>
    </div>
  );
}
