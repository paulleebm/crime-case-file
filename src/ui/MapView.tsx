import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ROOMS, PERSONS } from '../data/case';
import officePlan from '../assets/illustrations/office-plan.webp';
import type { PersonId } from '../data/types';
import { useGame, type PawnId } from '../engine/state';
import { Portrait } from '../sketch/components';
import { along, pathLength, route, type Pt } from './route';

// 집무실 평면도 (설정집 3.2). 7m × 6m를 1m = 60으로 그린다. 이 사건의 지도는 집무실 하나뿐이다.
// 처음에는 발견 위치만 표시한다. 진열대 빈자리와 책상 위 휴대폰은 현장 감식 결과와 함께 나타난다.
// 수사팀의 현장 감식(GT-E19)이 들어오면 닦인 혈흔 반응, 화장실까지 이어진 이동 흔적, 증거 번호가 지도에 나타난다.

export const MAP_W = 960;
export const MAP_H = 520;

/** 방 좌표: 서쪽 x 270, 동쪽 x 690, 북쪽 y 60, 남쪽 y 420 */

/** 발견 위치의 외형선 (옆으로 누운 자세, 칸막이 뒤) */
const BODY = 'M286 182 C284 172 292 166 300 168 L318 170 C324 166 330 168 330 174 L328 182 L320 186 L306 190 L292 192 C288 190 286 186 286 182Z';

export interface PlanMarks {
  /** 현장 감식 결과를 그린다 */
  forensic?: boolean;
  /** 방금 들어온 감식 결과 (나타나는 움직임을 준다) */
  fresh?: boolean;
  /** 사진에 나온 현장 표시 (발견 위치, 빈자리, 휴대폰) */
  scene?: boolean;
}

/** 감식 번호표: 바닥에 세우는 삼각 번호 */
function Placard({ n, x, y, delay }: { n: number; x: number; y: number; delay: number }) {
  return (
    <g className="placard" style={{ animationDelay: `${delay}ms` }} transform={`translate(${x} ${y})`}>
      <path d="M-11 9 L0 -12 L11 9 Z" className="placard-bg" />
      <text y={6} textAnchor="middle" fontSize={11} fontWeight={700} className="placard-n">{n}</text>
    </g>
  );
}

export function FloorPlan({ overlay, forensic = false, fresh = false, scene = true }: { overlay?: ReactNode } & PlanMarks) {
  const small = (x: number, y: number, t: string, size = 10, anchor: 'middle' | 'start' = 'middle') => <text x={x} y={y} fontSize={size} textAnchor={anchor} fill="var(--ink-2)">{t}</text>;
  return (
    <svg viewBox={`0 0 ${MAP_W} ${MAP_H}`} width="100%" className={`plan office-plan ${fresh ? 'fresh' : ''}`} style={{ display: 'block' }}>
      <image href={officePlan} x={0} y={0} width={MAP_W} height={MAP_H} preserveAspectRatio="none" />
      {forensic && (
        <g className="lum">
          <defs>
            <radialGradient id="lumGlow"><stop offset="0" stopColor="var(--lum)" stopOpacity=".55" /><stop offset="1" stopColor="var(--lum)" stopOpacity="0" /></radialGradient>
          </defs>
          {/* ① 책상과 출입문 사이 중앙 바닥의 닦인 혈흔 반응 */}
          <ellipse cx={526} cy={290} rx={30} ry={39} fill="url(#lumGlow)" />
          <ellipse cx={520} cy={316} rx={20} ry={18} fill="url(#lumGlow)" />
          {[0, 1, 2, 3, 4].map((k) => <path key={k} d={`M${507 + (k % 2) * 4} ${264 + k * 12} q 16 6 35 2`} className="lum-wipe" />)}
          {/* ② 화장실 문까지 이어진 끌린 흔적 */}
          <path d="M518 280 C 480 267 424 245 372 220 C 363 216 358 210 356 206 L340 190" className="lum-trail" />
          <path d="M530 287 C 483 272 429 251 383 229 C 373 223 369 214 366 206" className="lum-trail thin" />
          {/* ③ 화장실 안 발견 위치 주변 */}
          <ellipse cx={312} cy={186} rx={24} ry={10} fill="url(#lumGlow)" />
        </g>
      )}
      {scene && (
        <g className="scene-marks">
          <path d={BODY} className="body-outline" />
          {forensic && <rect x={651} y={306} width={20} height={20} className="empty-slot" />}
          {forensic && <rect x={584} y={88} width={10} height={16} rx={1.5} className="phone-mark" />}
        </g>
      )}
      <g style={{ pointerEvents: 'none' }}>
        <text x={336} y={86 + 54} fontSize={12} fontWeight={600} textAnchor="middle">화장실</text>
        <text x={560} y={256} fontSize={13} fontWeight={600} textAnchor="middle">집무실</text>
        {small(560, 102, '책상')}{small(545, 50, '창 (북)')}
        {small(661, 392, '진열대')}{forensic && small(661, 300 - 6, '빈자리', 9)}
        {small(300, 244, '소파')}{small(387, 317, '낮은 테이블', 9)}{small(412, 404, '응접 공간', 10)}
        {small(480, 445, '출입문 (카드)')}{small(380, 462, '3층 복도', 10)}
        {small(357, 226, '화장실 문', 9)}{forensic && small(589, 116, '휴대폰', 9)}
        <path d="M760 110 V76 M755 86 L760 76 L765 86" fill="none" stroke="var(--ink-2)" strokeWidth={1} />
        {small(760, 124, 'N', 11)}<path d="M730 470 H790 M730 465 V475 M790 465 V475" fill="none" stroke="var(--ink-2)" strokeWidth={1} />
        {small(760, 488, '1m', 10)}
        {small(704, 236, '7m × 6m', 10, 'start')}
      </g>
      {forensic && (
        <g className="placards">
          <Placard n={1} x={553} y={332} delay={0} />
          <Placard n={2} x={426} y={254} delay={250} />
          <Placard n={3} x={348} y={170} delay={500} />
          <Placard n={4} x={630} y={318} delay={750} />
          <Placard n={5} x={612} y={92} delay={1000} />
        </g>
      )}
      {overlay}
    </svg>
  );
}

/** 감식 약도 (현장 감식 결과 문서 속 그림) */
export function OfficeSketch({ width = 420 }: { width?: number }) {
  return <div style={{ width, maxWidth: '100%' }}><FloorPlan forensic /></div>;
}

export const PAWNS: { id: PawnId; label: string }[] = [{ id: 'V', label: '회장' }, ...(Object.keys(PERSONS) as PersonId[]).map(id => ({ id, label: PERSONS[id].name.slice(1) }))];

export function Pawn({ id, label, dashed, size = 42 }: { id: PawnId; label: string; dashed: boolean; size?: number }) {
  return (
    <>
      <div className="pawn-label">{label}</div>
      <div className={`pawn-photo ${dashed ? 'dashed' : ''}`}><Portrait person={id as PersonId | 'V'} w={size} h={Math.round((size * 51) / 42)} /></div>
    </>
  );
}

export interface WalkPace { speed: number; min: number; max: number }
const QUICK: WalkPace = { speed: 650, min: 260, max: 1400 };

/** 목표 지점이 바뀌면 문을 따라 걸어간다 (벽을 뚫고 지나가지 않는다) */
function useWalk(target: Pt, instant = false, pace: WalkPace = QUICK, onWalk?: (walking: boolean) => void): { pos: Pt; path: Pt[] | null } {
  const [pos, setPos] = useState<Pt>(target);
  const [walking, setWalking] = useState<Pt[] | null>(null);
  const cur = useRef<Pt>(target);
  const report = useRef(onWalk);
  report.current = onWalk;
  const [tx, ty] = target;
  useEffect(() => {
    if (instant || (cur.current[0] === tx && cur.current[1] === ty)) {
      cur.current = [tx, ty];
      setPos([tx, ty]);
      setWalking(null);
      return;
    }
    const path = route(cur.current, [tx, ty]);
    const dur = Math.min(pace.max, Math.max(pace.min, (pathLength(path) / pace.speed) * 1000));
    const start = performance.now();
    let id = 0;
    report.current?.(true);
    setWalking(path);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const e = t < 0.5 ? 2 * t * t : 1 - (2 - 2 * t) ** 2 / 2;
      cur.current = along(path, e);
      setPos(cur.current);
      if (t < 1) id = requestAnimationFrame(step);
      else { setWalking(null); report.current?.(false); }
    };
    id = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(id); report.current?.(false); };
  }, [tx, ty, instant, pace]);
  return { pos, path: walking };
}

/** 길을 따라 움직이는 말. trail이면 걷는 동안 지나갈 길을 지도 위에 점선으로 그린다 */
export function WalkingPawn({ id, label, x, y, dashed = false, size, className = '', instant = false, title, style, pace, onWalk, trail = false }: {
  id: PawnId; label: string; x: number; y: number; dashed?: boolean; size?: number; className?: string; instant?: boolean;
  title?: string; style?: CSSProperties; pace?: WalkPace; onWalk?: (walking: boolean) => void; trail?: boolean;
}) {
  const { pos: [px, py], path } = useWalk([x, y], instant, pace, onWalk);
  return (
    <>
      {trail && path && (
        <svg className="walk-trail" viewBox={`0 0 ${MAP_W} ${MAP_H}`} preserveAspectRatio="none" aria-hidden>
          <polyline points={path.map(([a, b]) => `${a},${b}`).join(' ')} />
          <circle cx={path[path.length - 1][0]} cy={path[path.length - 1][1]} r={7} />
        </svg>
      )}
      <div className={`pawn walking ${className}`} style={{ left: `${(px / MAP_W) * 100}%`, top: `${(py / MAP_H) * 100}%`, ...style }} title={title}>
        <Pawn id={id} label={label} dashed={dashed} size={size} />
      </div>
    </>
  );
}

const LEGEND_SCENE = ['- - 피해자 발견 위치 (화장실 바닥)'];
const LEGEND_FORENSIC = [
  '① 집무실 중앙 바닥의 닦인 혈흔 반응 (피해자 혈액)',
  '② 집무실 중앙에서 화장실 문까지 끌어 옮긴 형태의 미세 혈흔',
  '③ 화장실 안 혈흔은 발견 위치 주변뿐',
  '④ 진열대 빈자리 · 받침 모양 먼지 경계',
  '⑤ 회장 휴대폰 (책상 위에서 회수)',
];

/** 자료함의 집무실 평면도. 현장 감식 결과가 들어오면 지도가 바뀐다 */
export function MapView() {
  const { state, dispatch } = useGame();
  const forensic = state.owned.includes('GT-E19');
  const fresh = state.unseen.includes('GT-E19');
  // 평면도를 보면 감식 결과도 본 것으로 친다 (새 표시가 남지 않게, 움직임은 한 번 보여 준 뒤)
  useEffect(() => {
    if (!fresh) return;
    const t = window.setTimeout(() => dispatch({ type: 'seen', id: 'GT-E19' }), 4000);
    return () => window.clearTimeout(t);
  }, [fresh, dispatch]);
  return (
    <div className="docview">
      <h3 className="doc-title">집무실 평면도</h3>
      <div className="doc-meta">도면 · 3층 집무실 7m × 6m{forensic ? ' · 현장 감식 결과 반영' : ''}</div>
      {fresh && <div className="map-banner" role="status">현장 감식 결과가 평면도에 표시되었다.</div>}
      <div className="sheet map-sheet" style={{ padding: 12 }}>
        <FloorPlan forensic={forensic} fresh={fresh} />
      </div>
      <ul className="map-legend">
        {LEGEND_SCENE.map((t) => <li key={t}>{t}</li>)}
        {forensic && LEGEND_FORENSIC.map((t) => <li key={t} className="forensic">{t}</li>)}
      </ul>
      <p>남쪽 가운데 카드 출입문 하나로만 드나든다.<br />북서쪽 화장실은 집무실 안에 붙어 있고, 남쪽 면의 문이 안으로 열린다.<br />화장실 창문이나 다른 출입구, 바깥으로 이어지는 통로는 없다.</p><p>출입문에서 진열대로 갈 때 책상 뒤나 화장실 앞을 지나지 않는다.<br />화장실 문이 닫혀 있으면 칸막이 뒤의 바닥은 집무실에서 보이지 않는다.</p>
      {!forensic && <p className="muted">현장과 물건의 흔적은 수사팀에 감식을 요청할 수 있다.</p>}
    </div>
  );
}

/** 방 중심 좌표 (진상 해설용) */
export function roomCenter(id: string): [number, number] {
  const r = ROOMS.find((x) => x.id === id);
  if (!r) return [MAP_W / 2, MAP_H / 2];
  if (id === 'office') return [520, 300];
  if (id === 'bath') return [300, 150];
  return [r.rect[0] + r.rect[2] / 2, r.rect[1] + r.rect[3] / 2 - 6];
}
