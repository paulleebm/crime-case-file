import { MAP_LINKS, ROOMS } from '../data/case';

// 평면도 위 말의 길 찾기. 말은 벽을 뚫지 않고 문과 복도, 엘리베이터 승강로로만 다닌다.
// 구역은 모두 직사각형이라 구역 안에서는 직선으로, 구역 사이는 문 지점을 거쳐 간다.

export type Pt = [number, number];

const AREAS: { id: string; rect: [number, number, number, number] }[] = ROOMS.map((r) => ({ id: r.id, rect: r.rect }));
const LINKS = MAP_LINKS;

const inside = ([x, y]: Pt, [rx, ry, rw, rh]: [number, number, number, number]) => x >= rx && x <= rx + rw && y >= ry && y <= ry + rh;
const distToRect = ([x, y]: Pt, [rx, ry, rw, rh]: [number, number, number, number]) =>
  Math.hypot(Math.max(rx - x, 0, x - rx - rw), Math.max(ry - y, 0, y - ry - rh));

/** 이 점이 속한 구역 (벽 위나 바깥이면 가장 가까운 구역) */
export function areaOf(p: Pt): string {
  const hit = AREAS.find((a) => inside(p, a.rect));
  if (hit) return hit.id;
  return AREAS.reduce((best, a) => (distToRect(p, a.rect) < distToRect(p, best.rect) ? a : best)).id;
}

/** 놓은 자리를 구역 안쪽으로 당긴다 (말이 벽 위에 걸치지 않게) */
export function snapInside(p: Pt, margin = 14): Pt {
  const a = AREAS.find((x) => x.id === areaOf(p))!;
  const [rx, ry, rw, rh] = a.rect;
  const mx = Math.min(margin, rw / 2), my = Math.min(margin, rh / 2);
  return [Math.min(Math.max(p[0], rx + mx), rx + rw - mx), Math.min(Math.max(p[1], ry + my), ry + rh - my)];
}

/** p에서 q까지 지나는 점들 (구역 그래프에서 너비 우선 탐색. 거치는 구역이 가장 적은 길, 같으면 먼저 적힌 통로) */
export function route(p: Pt, q: Pt): Pt[] {
  const from = areaOf(p), to = areaOf(q);
  if (from === to) return [p, q];
  const prev = new Map<string, { area: string; via: Pt[] }>();
  const queue = [from];
  const seen = new Set([from]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === to) break;
    for (const l of LINKS) {
      const next = l.a === cur ? l.b : l.b === cur ? l.a : null;
      if (!next || seen.has(next)) continue;
      seen.add(next);
      prev.set(next, { area: cur, via: l.a === cur ? l.via : [...l.via].reverse() });
      queue.push(next);
    }
  }
  if (!prev.has(to)) return [p, q];
  const vias: Pt[] = [];
  for (let a = to; a !== from; a = prev.get(a)!.area) vias.unshift(...prev.get(a)!.via);
  return [p, ...vias, q];
}

/** 꺾은선 위에서 비율 t(0~1)의 점 */
export function along(path: Pt[], t: number): Pt {
  const seg = path.slice(1).map((b, i) => Math.hypot(b[0] - path[i][0], b[1] - path[i][1]));
  const total = seg.reduce((s, d) => s + d, 0) || 1;
  let d = t * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? Math.min(1, d / seg[i]) : 1;
      return [path[i][0] + (path[i + 1][0] - path[i][0]) * k, path[i][1] + (path[i + 1][1] - path[i][1]) * k];
    }
    d -= seg[i];
  }
  return path[path.length - 1];
}

export const pathLength = (path: Pt[]) => path.slice(1).reduce((s, b, i) => s + Math.hypot(b[0] - path[i][0], b[1] - path[i][1]), 0);
