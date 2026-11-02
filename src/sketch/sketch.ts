// 연필 스케치 선 생성기. 직선은 여러 번 덧그리고 끝을 살짝 넘기며,
// 곡선은 실제 SVG 호(A 명령)로 그리고 직선보다 길게 넘긴다.

export type Rng = () => number;

export function rng(seed: number): Rng {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface Stroke {
  d: string;
  w: number;
  op: number;
  dash?: string;
}

export interface LineOpt {
  os?: number; // 끝 넘김(px)
  w?: number;
  passes?: number;
  j?: number; // 떨림
  op?: number;
  dash?: string;
}

export function line(out: Stroke[], r: Rng, x1: number, y1: number, x2: number, y2: number, o: LineOpt = {}) {
  const passes = o.passes ?? 2;
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
  for (let p = 0; p < passes; p++) {
    const os = o.os ?? 5, o1 = os * (0.3 + r() * 0.9), o2 = os * (0.3 + r() * 0.9), j = o.j ?? 0.8;
    const a = (r() - 0.5) * 2 * j, b = (r() - 0.5) * 2 * j;
    const sx = x1 - ux * o1 + nx * a, sy = y1 - uy * o1 + ny * a;
    const ex = x2 + ux * o2 + nx * b, ey = y2 + uy * o2 + ny * b;
    out.push({ d: `M${sx.toFixed(1)} ${sy.toFixed(1)}L${ex.toFixed(1)} ${ey.toFixed(1)}`, w: (o.w ?? 1) * (0.65 + r() * 0.5), op: (o.op ?? 0.85) * (0.55 + r() * 0.45), dash: o.dash });
  }
}

export function rect(out: Stroke[], r: Rng, x: number, y: number, w: number, h: number, o: LineOpt = {}) {
  line(out, r, x, y, x + w, y, o);
  line(out, r, x + w, y, x + w, y + h, o);
  line(out, r, x + w, y + h, x, y + h, o);
  line(out, r, x, y + h, x, y, o);
}

/** 각도는 라디안. a1 이 a0 보다 작으면 반시계 방향. sy 는 세로 비율(타원) */
export function arc(out: Stroke[], r: Rng, cx: number, cy: number, rad: number, a0: number, a1: number, o: LineOpt & { sy?: number } = {}) {
  const passes = o.passes ?? 2, dir = a1 >= a0 ? 1 : -1, sy = o.sy ?? 1;
  for (let p = 0; p < passes; p++) {
    const os = (o.os ?? 12) / rad;
    const s0 = a0 - dir * os * (0.5 + r() * 0.9), s1 = a1 + dir * os * (0.5 + r() * 0.9);
    const rr = rad + (r() - 0.5) * 2 * (o.j ?? 1.2), x0 = cx + (r() - 0.5) * 1.4, y0 = cy + (r() - 0.5) * 1.4;
    const pt = (a: number) => `${(x0 + Math.cos(a) * rr).toFixed(2)} ${(y0 + Math.sin(a) * rr * sy).toFixed(2)}`;
    const n = Math.ceil(Math.abs(s1 - s0) / (Math.PI * 0.9)), sw = dir > 0 ? 1 : 0;
    let d = `M${pt(s0)}`;
    for (let k = 1; k <= n; k++) d += ` A${rr.toFixed(2)} ${(rr * sy).toFixed(2)} 0 0 ${sw} ${pt(s0 + ((s1 - s0) * k) / n)}`;
    out.push({ d, w: (o.w ?? 1) * (0.65 + r() * 0.5), op: (o.op ?? 0.85) * (0.55 + r() * 0.45), dash: o.dash });
  }
}

export function circle(out: Stroke[], r: Rng, cx: number, cy: number, rad: number, o: LineOpt & { sy?: number } = {}) {
  arc(out, r, cx, cy, rad, -Math.PI / 2, Math.PI * 1.5, { os: 9, ...o });
}

/** 사선 빗금. 영역 안으로 잘라서 그린다 */
export function hatch(out: Stroke[], r: Rng, x: number, y: number, w: number, h: number, gap = 6, o: LineOpt = {}) {
  for (let k = -h; k < w; k += gap) {
    const t0 = Math.max(0, -k), t1 = Math.min(h, w - k);
    if (t1 - t0 < 1) continue;
    line(out, r, x + k + t0, y + h - t0, x + k + t1, y + h - t1, { os: 0, w: 0.45, passes: 1, op: 0.4, j: 0.3, ...o });
  }
}

export function boxStrokes(w: number, h: number, seed: number, mode: string): Stroke[] {
  const out: Stroke[] = [];
  const r = rng(seed);
  const big = Math.min(w, h) > 120;
  rect(out, r, 0.5, 0.5, w - 1, h - 1, { os: big ? 7 : 4, w: big ? 1.15 : 0.95, passes: 2, dash: mode === 'dash' ? '5 4' : undefined });
  if (mode === 'double') rect(out, r, 3.5, 3.5, w - 7, h - 7, { os: 2, w: 0.75, passes: 1 });
  return out;
}
