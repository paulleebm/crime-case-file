import { useEffect, useState, type CSSProperties } from 'react';
import { hashSeed, rng, type Rng } from '../sketch/sketch';

// 감식 사진. 연필 그림이 아니라 캔버스에 빛과 면을 칠한 뒤, 플래시를 터뜨려 찍은 감식 사진처럼 다듬는다.
//   1. 장면: 그러데이션 면, 반사광, 질감
//   2. 촬영: 플래시 중심광, 비네팅, 입자, 약한 흐림
//   3. 감식 표시: 척도 자, 증거 번호표, 촬영 정보 띠
// src/assets/evidence/<이름>.png(.jpg, .webp)를 넣으면 그린 사진 대신 그 파일을 쓴다 (촬영 정보 띠는 게임이 덧입힌다).
// 생성기용 프롬프트: design/evidence-production/gold-trophy-image-prompts.md

type C = CanvasRenderingContext2D;
const W = 960, H = 600;
const FONT = '"IBM Plex Sans KR", "Noto Sans KR", "Malgun Gothic", sans-serif';
const MONO = '"Nanum Gothic Coding", Consolas, monospace';

const lin = (c: C, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => { const g = c.createLinearGradient(x0, y0, x1, y1); for (const [o, s] of stops) g.addColorStop(o, s); return g; };
const rad = (c: C, x: number, y: number, r0: number, r1: number, stops: [number, string][]) => { const g = c.createRadialGradient(x, y, r0, x, y, r1); for (const [o, s] of stops) g.addColorStop(o, s); return g; };
function poly(c: C, pts: [number, number][], fill?: string | CanvasGradient, stroke?: string, lw = 1) {
  c.beginPath(); pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath();
  if (fill) { c.fillStyle = fill; c.fill(); }
  if (stroke) { c.strokeStyle = stroke; c.lineWidth = lw; c.stroke(); }
}
function rr(c: C, x: number, y: number, w: number, h: number, r: number) { c.beginPath(); c.roundRect(x, y, w, h, r); }

/** 바닥·벽 질감: 작은 점을 흩뿌린다 */
function grain(c: C, r: Rng, x: number, y: number, w: number, h: number, n: number, a: number) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = r() > 0.5 ? `rgba(255,255,255,${a * r()})` : `rgba(0,0,0,${a * 1.3 * r()})`;
    c.fillRect(x + r() * w, y + r() * h, 1 + r() * 1.6, 1 + r() * 1.6);
  }
}

/** 감식 척도 자 (L자, 흑백 눈금, cm) */
function scale(c: C, x: number, y: number, len = 260, rot = 0) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 6; c.shadowOffsetY = 2;
  c.fillStyle = '#f4f4ef'; c.fillRect(0, 0, len, 26); c.fillRect(0, 0, 26, -90);
  c.shadowColor = 'transparent';
  for (let i = 0; i < len / 10; i++) { c.fillStyle = i % 2 ? '#f4f4ef' : '#151515'; c.fillRect(i * 10, 0, 10, 7); }
  for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? '#f4f4ef' : '#151515'; c.fillRect(0, -i * 10 - 10, 7, 10); }
  c.strokeStyle = '#222'; c.lineWidth = 0.7;
  for (let i = 0; i <= len; i += 2) { c.beginPath(); c.moveTo(i, 7); c.lineTo(i, i % 10 ? 10 : 14); c.stroke(); }
  c.fillStyle = '#111'; c.font = `600 10px ${MONO}`;
  for (let i = 1; i < len / 10; i++) if (i % 2 === 0) c.fillText(String(i), i * 10 - 3, 23);
  c.fillText('cm', len - 22, 23);
  c.restore();
}

/** 증거 번호표 (노란 삼각 텐트) */
function tent(c: C, x: number, y: number, n: number, s = 1) {
  c.save(); c.translate(x, y); c.scale(s, s);
  c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 8; c.shadowOffsetY = 4;
  poly(c, [[-22, 20], [0, -26], [22, 20]], lin(c, 0, -26, 0, 20, [[0, '#f6d23e'], [1, '#d8a91c']]));
  c.shadowColor = 'transparent';
  poly(c, [[22, 20], [0, -26], [8, 22]], 'rgba(0,0,0,.18)');
  c.fillStyle = '#141414'; c.font = `800 22px ${FONT}`; c.textAlign = 'center'; c.fillText(String(n), -2, 14);
  c.restore();
}

/** 사진 카드 (흰 정보 카드) */
function card(c: C, x: number, y: number, lines: string[], rot = -0.03) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.shadowColor = 'rgba(0,0,0,.3)'; c.shadowBlur = 8; c.shadowOffsetY = 3;
  c.fillStyle = '#f7f6f1'; c.fillRect(0, 0, 200, 26 + lines.length * 18);
  c.shadowColor = 'transparent';
  c.fillStyle = '#b02020'; c.fillRect(0, 0, 200, 6);
  c.fillStyle = '#1a1a1a'; c.font = `600 13px ${FONT}`;
  lines.forEach((t, i) => c.fillText(t, 10, 26 + i * 18));
  c.restore();
}

/** 플래시·비네팅·입자·흐림으로 사진처럼 */
function finish(src: HTMLCanvasElement, o: { flash?: [number, number]; flashA?: number; vignette?: number; noise?: number; blur?: number; dark?: boolean }, seed: number): HTMLCanvasElement {
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const c = out.getContext('2d')!;
  c.filter = `blur(${o.blur ?? 0.55}px) contrast(1.06) saturate(.92)`;
  c.drawImage(src, 0, 0);
  c.filter = 'none';
  if (o.flash) {
    c.globalCompositeOperation = 'soft-light';
    c.fillStyle = rad(c, o.flash[0], o.flash[1], 0, W * 0.75, [[0, `rgba(255,255,250,${o.flashA ?? 0.55})`], [1, 'rgba(0,0,0,.35)']]);
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  }
  c.fillStyle = rad(c, W / 2, H / 2, W * 0.32, W * 0.72, [[0, 'rgba(0,0,0,0)'], [1, `rgba(0,0,0,${o.vignette ?? 0.45})`]]);
  c.fillRect(0, 0, W, H);
  const r = rng(seed);
  const img = c.getImageData(0, 0, W, H);
  const d = img.data, k = o.noise ?? 10;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * k * (o.dark ? 1.6 : 1);
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 1.05;
  }
  c.putImageData(img, 0, 0);
  return out;
}

/** 아래쪽 촬영 정보 띠 */
function stamp(c: C, left: string, right: string) {
  c.fillStyle = 'rgba(0,0,0,.6)'; c.fillRect(0, H - 30, W, 30);
  c.fillStyle = '#efe9c8'; c.font = `600 15px ${MONO}`;
  c.textAlign = 'left'; c.fillText(left, 14, H - 10);
  c.textAlign = 'right'; c.fillText(right, W - 14, H - 10);
  c.textAlign = 'left';
}

const canvas = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return { cv, c: cv.getContext('2d')! }; };

// ───────────── 금 트로피 (TR-01) ─────────────

/** 트로피: 석재 받침 위의 금제 조형 (기둥과 구). x는 가운데, y는 받침 바닥, s는 배율 */
function trophy(c: C, r: Rng, x: number, y: number, s: number, chipped = true) {
  c.save(); c.translate(x, y); c.scale(s, s);
  // 그림자
  c.fillStyle = rad(c, 0, 4, 10, 170, [[0, 'rgba(0,0,0,.45)'], [1, 'rgba(0,0,0,0)']]);
  c.beginPath(); c.ellipse(10, 4, 170, 26, 0, 0, Math.PI * 2); c.fill();
  // 석재 받침 (아래가 넓은 사다리꼴, 위 면)
  const base: [number, number][] = [[-120, 0], [120, 0], [100, -70], [-100, -70]];
  poly(c, base, lin(c, -120, 0, 120, -70, [[0, '#26302d'], [0.45, '#3b4743'], [0.7, '#2d3734'], [1, '#1d2523']]));
  c.save(); poly(c, base); c.clip();
  c.strokeStyle = 'rgba(210,220,214,.22)'; c.lineWidth = 1.2;
  for (let i = 0; i < 9; i++) { c.beginPath(); let px = -130 + r() * 260, py = -70; c.moveTo(px, py); for (let k = 0; k < 6; k++) { px += (r() - 0.5) * 50; py += 14; c.lineTo(px, py); } c.stroke(); }
  c.restore();
  poly(c, [[-100, -70], [100, -70], [86, -84], [-86, -84]], lin(c, 0, -84, 0, -70, [[0, '#55625d'], [1, '#33403c']]));
  // 금 명판
  poly(c, [[-64, -52], [64, -52], [60, -20], [-60, -20]], lin(c, -64, -52, 64, -20, [[0, '#7a5a12'], [0.3, '#e8c25a'], [0.5, '#fff1b8'], [0.7, '#c79a2c'], [1, '#6e4f10']]));
  c.fillStyle = 'rgba(60,40,5,.85)'; c.font = `700 10px ${FONT}`; c.textAlign = 'center';
  c.fillText('호텔 로베르 개관 기념', 0, -38); c.font = `600 9px ${FONT}`; c.fillText('류정환', 0, -26);
  if (chipped) {
    // 받침 오른쪽 아래 모서리 결손과 갈색 얼룩
    poly(c, [[120, 0], [101, 0], [108, -14], [114, -18]], '#0f1413');
    poly(c, [[101, 0], [108, -14], [104, -16], [96, -4]], 'rgba(160,170,165,.5)');
    c.fillStyle = 'rgba(92,38,24,.55)';
    for (let i = 0; i < 7; i++) { c.beginPath(); c.ellipse(88 + r() * 18, -12 - r() * 26, 2 + r() * 3, 1.5 + r() * 2.5, r(), 0, Math.PI * 2); c.fill(); }
  }
  // 금 기둥
  const gold = (x0: number, x1: number) => lin(c, x0, 0, x1, 0, [[0, '#5e430b'], [0.18, '#b8892a'], [0.36, '#f3d27a'], [0.46, '#fffbe4'], [0.56, '#e9bf55'], [0.78, '#9c7019'], [1, '#4d3608']]);
  poly(c, [[-26, -84], [26, -84], [14, -250], [-14, -250]], gold(-26, 26));
  poly(c, [[-40, -84], [40, -84], [34, -98], [-34, -98]], gold(-40, 40));
  // 구와 고리
  c.fillStyle = rad(c, -12, -298, 2, 46, [[0, '#fffbe8'], [0.25, '#f3d37c'], [0.65, '#b17f20'], [1, '#4b3307']]);
  c.beginPath(); c.arc(0, -290, 42, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(255,240,200,.55)'; c.lineWidth = 2.2;
  c.beginPath(); c.ellipse(0, -290, 58, 16, -0.35, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = 'rgba(90,60,10,.6)'; c.lineWidth = 1.2;
  c.beginPath(); c.ellipse(0, -290, 58, 16, -0.35, 0.2, Math.PI - 0.2); c.stroke();
  // 반사 광택
  c.fillStyle = 'rgba(255,255,245,.65)'; c.beginPath(); c.ellipse(-16, -306, 10, 6, -0.6, 0, Math.PI * 2); c.fill();
  c.restore();
}

/** 감식 배경지 (회색 무지 배경) */
function backdrop(c: C, top = '#c9c8c2', bottom = '#9d9c96') {
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, top], [0.55, '#b9b8b2'], [1, bottom]]);
  c.fillRect(0, 0, W, H);
}

function photoTrophy(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-trophy'));
  backdrop(c); grain(c, r, 0, 0, W, H, 2600, 0.05);
  trophy(c, r, 470, 470, 1.2);
  scale(c, 120, 522, 300);
  card(c, 700, 60, ['증거 TR-01 · 회수 트로피', '2026-도심-1012', '온정귀금속 보관분']);
  tent(c, 760, 520, 1);
  const out = finish(cv, { flash: [470, 230], flashA: 0.5, vignette: 0.4 }, 11);
  stamp(out.getContext('2d')!, '2026.10.13 14:22  증거 TR-01 전면', '도심서 과학수사 · 1/6');
  return out;
}

function photoBase(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-base'));
  backdrop(c, '#cfcec8', '#a5a49e'); grain(c, r, 0, 0, W, H, 2600, 0.05);
  // 받침 모서리 확대 (왼쪽)
  c.save(); c.translate(140, 470); c.scale(2.4, 2.4);
  const base: [number, number][] = [[0, 0], [150, 0], [130, -110], [0, -110]];
  poly(c, base, lin(c, 0, 0, 150, -110, [[0, '#26302d'], [0.5, '#3d4945'], [1, '#1e2624']]));
  c.save(); poly(c, base); c.clip(); c.strokeStyle = 'rgba(210,220,214,.2)'; c.lineWidth = 0.8;
  for (let i = 0; i < 6; i++) { c.beginPath(); let px = r() * 150, py = -110; c.moveTo(px, py); for (let k = 0; k < 5; k++) { px += (r() - 0.5) * 30; py += 24; c.lineTo(px, py); } c.stroke(); }
  c.restore();
  // 결손부
  poly(c, [[150, 0], [124, 0], [131, -16], [140, -23], [146, -19]], '#0d1211');
  poly(c, [[124, 0], [131, -16], [127, -18], [118, -6]], 'rgba(170,178,173,.55)');
  c.fillStyle = 'rgba(96,38,22,.6)';
  for (let i = 0; i < 9; i++) { c.beginPath(); c.ellipse(108 + r() * 26, -6 - r() * 40, 1.4 + r() * 2.4, 1 + r() * 2, r(), 0, Math.PI * 2); c.fill(); }
  c.restore();
  // 회수 조각 (오른쪽, 검은 판 위)
  c.save(); c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 10; c.shadowOffsetY = 4;
  c.fillStyle = '#2b2b2b'; rr(c, 610, 250, 230, 190, 6); c.fill(); c.restore();
  c.save(); c.translate(700, 370); c.scale(2.4, 2.4);
  poly(c, [[26, 0], [0, 0], [7, -16], [16, -23], [22, -19]], lin(c, 0, 0, 26, -23, [[0, '#3a4642'], [1, '#202826']]));
  c.fillStyle = 'rgba(96,38,22,.7)'; c.beginPath(); c.ellipse(10, -6, 3, 2, 0.4, 0, Math.PI * 2); c.fill();
  c.restore();
  // 대조 표시
  c.strokeStyle = '#d42a2a'; c.lineWidth = 2.5; c.setLineDash([9, 6]);
  c.beginPath(); c.ellipse(450, 440, 62, 54, 0, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.ellipse(735, 340, 54, 46, 0, 0, Math.PI * 2); c.stroke();
  c.setLineDash([]); c.beginPath(); c.moveTo(512, 430); c.lineTo(678, 352); c.stroke();
  poly(c, [[680, 351], [664, 352], [672, 364]], '#d42a2a');
  c.fillStyle = '#d42a2a'; c.font = `800 22px ${FONT}`; c.fillText('A', 380, 380); c.fillText('B', 790, 300);
  c.fillStyle = '#f2f2ec'; c.font = `600 13px ${FONT}`; c.fillText('B · 치명 손상 부위 회수 조각', 622, 274);
  scale(c, 560, 522, 260);
  card(c, 60, 50, ['A 받침 결손부 · B 회수 조각', '결손면 대조', '2026-도심-1012']);
  const out = finish(cv, { flash: [440, 300], flashA: 0.45, vignette: 0.42 }, 22);
  stamp(out.getContext('2d')!, '2026.10.13 15:05  TR-01 받침 결손부 대조', '도심서 과학수사 · 3/6');
  return out;
}

function photoUnderside(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-underside'));
  backdrop(c, '#b9b8b2', '#8f8e88'); grain(c, r, 0, 0, W, H, 2400, 0.05);
  // 뒤집은 받침 밑면 (비스듬한 조명)
  c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
  poly(c, [[150, 90], [820, 70], [850, 470], [130, 500]], lin(c, 150, 90, 850, 470, [[0, '#46524e'], [0.5, '#323d39'], [1, '#232c29']]));
  c.restore();
  // 오목한 면
  poly(c, [[230, 160], [740, 146], [762, 410], [214, 430]], lin(c, 230, 160, 762, 410, [[0, '#1d2522'], [0.6, '#2a3431'], [1, '#38443f']]));
  poly(c, [[230, 160], [740, 146], [734, 160], [238, 174]], 'rgba(0,0,0,.35)');
  grain(c, r, 220, 150, 540, 280, 1600, 0.06);
  // 피를 매개로 한 엄지 지문 (갈색, 일부 끊김)
  c.save(); c.translate(500, 300); c.rotate(-0.35);
  for (let k = 0; k < 15; k++) {
    const rx = 10 + k * 4.2, ry = 14 + k * 5.4;
    c.strokeStyle = `rgba(${118 - k * 2},${44 - k},${28},${0.78 - k * 0.03})`;
    c.lineWidth = 2 + r() * 0.8;
    let a0 = -Math.PI * 0.95;
    while (a0 < Math.PI * 0.95) {
      const len = 0.25 + r() * 0.6;
      c.beginPath(); c.ellipse(0, 0, rx, ry, 0, a0, Math.min(Math.PI * 0.95, a0 + len)); c.stroke();
      a0 += len + 0.05 + r() * 0.12;
    }
  }
  c.fillStyle = 'rgba(110,40,24,.35)'; c.beginPath(); c.ellipse(0, 80, 60, 22, 0, 0, Math.PI * 2); c.fill();
  c.restore();
  // 감식 화살표와 척도
  c.fillStyle = '#f5f2e6'; c.font = `800 18px ${FONT}`;
  c.save(); c.translate(660, 230); poly(c, [[0, 0], [40, -14], [40, 14]], '#f5f2e6'); c.fillRect(40, -4, 50, 8); c.restore();
  c.fillText('1', 760, 222);
  scale(c, 300, 522, 260);
  card(c, 690, 470, ['TR-01 받침 밑면 오목부', '혈흔 지문 · 원본 검사'], 0.02);
  const out = finish(cv, { flash: [260, 120], flashA: 0.5, vignette: 0.5 }, 33);
  stamp(out.getContext('2d')!, '2026.10.13 16:40  TR-01 받침 밑면', '도심서 과학수사 · 5/6');
  return out;
}

// ───────────── 집무실 ─────────────

function photoScene(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-scene'));
  // 소실점 (가운데 약간 위)
  const vx = 480, vy = 250;
  // 천장
  poly(c, [[0, 0], [W, 0], [690, 130], [270, 130]], lin(c, 0, 0, 0, 130, [[0, '#d8d4c9'], [1, '#efebe1']]));
  for (const x of [380, 580]) { c.fillStyle = rad(c, x, 70, 2, 60, [[0, 'rgba(255,250,230,.95)'], [1, 'rgba(255,250,230,0)']]); c.fillRect(x - 60, 20, 120, 100); c.fillStyle = '#fffdf2'; rr(c, x - 22, 64, 44, 8, 3); c.fill(); }
  // 안쪽 벽 (북쪽): 창과 블라인드
  poly(c, [[270, 130], [690, 130], [690, 360], [270, 360]], lin(c, 0, 130, 0, 360, [[0, '#ddd6c6'], [1, '#c9c1b0']]));
  poly(c, [[330, 150], [650, 150], [650, 268], [330, 268]], '#1b2533');
  for (let y = 154; y < 266; y += 7) { c.fillStyle = 'rgba(200,205,210,.35)'; c.fillRect(330, y, 320, 2); }
  c.strokeStyle = '#8e8676'; c.lineWidth = 4; c.strokeRect(330, 150, 320, 118);
  // 왼쪽 벽 (화장실 벽과 닫힌 문)
  poly(c, [[0, 0], [270, 130], [270, 360], [0, 560]], lin(c, 0, 0, 270, 0, [[0, '#b9b1a1'], [1, '#d3cbbb']]));
  poly(c, [[110, 158], [214, 182], [214, 382], [110, 430]], lin(c, 110, 0, 214, 0, [[0, '#8d7558'], [1, '#a68c6c']]));
  c.strokeStyle = 'rgba(60,40,20,.5)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#c9b78e'; c.beginPath(); c.ellipse(198, 286, 5, 7, 0, 0, Math.PI * 2); c.fill();
  // 오른쪽 벽
  poly(c, [[W, 0], [690, 130], [690, 360], [W, 560]], lin(c, W, 0, 690, 0, [[0, '#b4ac9c'], [1, '#d1c9b9']]));
  // 바닥 (카펫)
  poly(c, [[0, 560], [270, 360], [690, 360], [W, 560], [W, H], [0, H]], lin(c, 0, 360, 0, H, [[0, '#6b5a47'], [1, '#4e4033']]));
  c.save(); poly(c, [[0, 560], [270, 360], [690, 360], [W, 560], [W, H], [0, H]]); c.clip();
  c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = 1;
  for (let i = -10; i <= 10; i++) { c.beginPath(); c.moveTo(vx + i * 24, 360); c.lineTo(vx + i * 110, H); c.stroke(); }
  grain(c, r, 0, 360, W, 240, 5000, 0.06);
  c.restore();
  // 책상 (창 아래)
  poly(c, [[392, 312], [572, 312], [592, 336], [372, 336]], lin(c, 0, 312, 0, 336, [[0, '#5a3b25'], [1, '#432a19']]));
  poly(c, [[372, 336], [592, 336], [592, 374], [372, 374]], '#36220f');
  c.fillStyle = '#0d0d0f'; rr(c, 520, 318, 20, 10, 2); c.fill(); c.fillStyle = 'rgba(255,255,255,.25)'; c.fillRect(523, 319, 14, 2);
  tent(c, 548, 314, 5, 0.55);
  // 소파와 낮은 테이블 (왼쪽 앞)
  poly(c, [[0, 470], [150, 410], [190, 430], [60, 520], [0, 540]], lin(c, 0, 410, 190, 520, [[0, '#2e2a29'], [1, '#43403d']]));
  poly(c, [[170, 470], [300, 440], [340, 462], [214, 500]], lin(c, 170, 440, 340, 500, [[0, '#3a2a1c'], [1, '#2a1e14']]));
  // 진열대 (오른쪽, 유리장)
  poly(c, [[740, 230], [860, 200], [860, 560], [740, 500]], lin(c, 740, 0, 860, 0, [[0, '#4a3a2a'], [1, '#2f2418']]));
  poly(c, [[752, 244], [848, 220], [848, 480], [752, 472]], 'rgba(170,190,200,.18)');
  for (const y of [300, 380]) { c.strokeStyle = 'rgba(220,230,235,.5)'; c.lineWidth = 2; c.beginPath(); c.moveTo(752, y + 12); c.lineTo(848, y - 6); c.stroke(); }
  // 다른 기념품 (작은 상패 둘), 빈자리
  c.fillStyle = '#b48a34'; c.fillRect(770, 270, 14, 30); c.fillStyle = '#70675a'; c.fillRect(812, 352, 22, 26);
  c.strokeStyle = 'rgba(255,255,255,.35)'; c.setLineDash([4, 4]); c.lineWidth = 1.4; c.strokeRect(792, 340, 18, 24); c.setLineDash([]);
  tent(c, 800, 318, 4, 0.5);
  // 화장실 문 앞 번호
  tent(c, 236, 430, 3, 0.7);
  grain(c, r, 0, 0, W, H, 3000, 0.04);
  const out = finish(cv, { flash: [500, 330], flashA: 0.5, vignette: 0.55 }, 44);
  stamp(out.getContext('2d')!, '2026.10.12 21:58  집무실 전경 (남쪽 출입문)', '도심서 과학수사 · 현장 1');
  return out;
}

function photoBath(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-bath'));
  // 타일 벽과 바닥
  c.fillStyle = lin(c, 0, 0, 0, 300, [[0, '#d9dbd7'], [1, '#c6c9c4']]); c.fillRect(0, 0, W, 300);
  c.strokeStyle = 'rgba(120,125,120,.45)'; c.lineWidth = 1.5;
  for (let x = 0; x < W; x += 64) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 300); c.stroke(); }
  for (let y = 0; y < 300; y += 64) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  poly(c, [[0, 300], [W, 300], [W, H], [0, H]], lin(c, 0, 300, 0, H, [[0, '#a7a8a2'], [1, '#8c8d87']]));
  c.save(); poly(c, [[0, 300], [W, 300], [W, H], [0, H]]); c.clip();
  for (let i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(480 + i * 70, 300); c.lineTo(480 + i * 170, H); c.stroke(); }
  for (const y of [340, 400, 480, 580]) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
  c.restore();
  // 변기, 세면대, 칸막이
  c.fillStyle = lin(c, 120, 0, 240, 0, [[0, '#e9ebe8'], [1, '#cfd2cd']]); rr(c, 120, 170, 120, 70, 10); c.fill();
  c.beginPath(); c.ellipse(180, 300, 70, 40, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#eef0ed'; rr(c, 640, 150, 220, 40, 6); c.fill(); c.fillStyle = '#c7cac5'; c.beginPath(); c.ellipse(750, 170, 70, 14, 0, 0, Math.PI * 2); c.fill();
  poly(c, [[560, 60], [600, 60], [600, 520], [560, 540]], lin(c, 560, 0, 600, 0, [[0, '#b8b2a5'], [1, '#d6d0c3']]));
  // 바닥의 흰 가림천과 그 아래 형체 (발견 위치)
  c.save(); c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 16; c.shadowOffsetY = 6;
  c.fillStyle = lin(c, 0, 380, 0, 540, [[0, '#f4f4f1'], [1, '#d5d6d1']]);
  c.beginPath(); c.moveTo(150, 520); c.bezierCurveTo(170, 420, 300, 400, 420, 420); c.bezierCurveTo(500, 400, 540, 430, 540, 470); c.bezierCurveTo(540, 520, 470, 540, 380, 540); c.bezierCurveTo(260, 548, 170, 545, 150, 520); c.fill();
  c.restore();
  c.strokeStyle = 'rgba(0,0,0,.12)'; c.lineWidth = 2;
  for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(200 + i * 50, 430 + (i % 2) * 8); c.quadraticCurveTo(220 + i * 50, 480, 210 + i * 52, 530); c.stroke(); }
  // 머리 쪽 바닥의 작은 갈색 얼룩
  c.fillStyle = 'rgba(96,36,22,.55)'; c.beginPath(); c.ellipse(130, 500, 34, 12, -0.2, 0, Math.PI * 2); c.fill();
  tent(c, 610, 520, 3, 0.8);
  scale(c, 700, 522, 200);
  grain(c, r, 0, 0, W, H, 3000, 0.04);
  const out = finish(cv, { flash: [420, 260], flashA: 0.55, vignette: 0.5 }, 55);
  stamp(out.getContext('2d')!, '2026.10.12 22:04  화장실 내부 · 발견 위치 (가림 처리)', '도심서 과학수사 · 현장 2');
  return out;
}

function photoLuminol(): HTMLCanvasElement {
  const { cv, c } = canvas(); const r = rng(hashSeed('gt-luminol'));
  // 암실: 카펫 바닥이 아주 어둡게 보인다
  c.fillStyle = lin(c, 0, 0, 0, H, [[0, '#07090c'], [1, '#0d1014']]); c.fillRect(0, 0, W, H);
  grain(c, r, 0, 0, W, H, 9000, 0.05);
  // 소파 다리·테이블 모서리의 어두운 윤곽
  c.fillStyle = 'rgba(40,46,56,.7)'; c.fillRect(70, 0, 30, 170); c.fillRect(70, 150, 140, 22); c.fillRect(760, 60, 160, 26); c.fillRect(890, 60, 22, 140);
  // 루미놀 반응: 닦은 결이 남은 넓은 얼룩과 위쪽(화장실 문 쪽)으로 이어진 끌린 흔적
  c.globalCompositeOperation = 'lighter';
  const blob = (x: number, y: number, rx: number, ry: number, a: number, rot = 0) => { c.save(); c.translate(x, y); c.rotate(rot); c.scale(1, ry / rx); c.fillStyle = rad(c, 0, 0, 0, rx, [[0, `rgba(80,190,255,${a})`], [0.5, `rgba(40,140,240,${a * 0.45})`], [1, 'rgba(20,80,200,0)']]); c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2); c.fill(); c.restore(); };
  for (let i = 0; i < 26; i++) blob(360 + (r() - 0.5) * 260, 420 + (r() - 0.5) * 110, 26 + r() * 40, 10 + r() * 18, 0.18 + r() * 0.2, (r() - 0.5) * 0.8);
  // 닦은 결 (호 모양 줄무늬)
  c.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    c.strokeStyle = `rgba(110,210,255,${0.12 + r() * 0.12})`; c.lineWidth = 6 + r() * 8;
    c.beginPath(); c.arc(330 + i * 18, 470, 90 + r() * 30, -2.7, -1.6); c.stroke();
  }
  // 끌린 흔적 (두 줄, 위로)
  for (const off of [0, 30]) {
    c.strokeStyle = 'rgba(90,200,255,.22)'; c.lineWidth = 14;
    c.beginPath(); c.moveTo(420 + off, 380); c.bezierCurveTo(440 + off, 290, 470 + off, 190, 520 + off, 40); c.stroke();
    for (let k = 0; k < 40; k++) { const t = r(); blob(420 + off + t * 100 + (r() - 0.5) * 14, 380 - t * 340, 4 + r() * 6, 2 + r() * 4, 0.35 + r() * 0.25); }
  }
  c.globalCompositeOperation = 'source-over';
  // 번호표 실루엣 (어둠 속에서 반사)
  c.fillStyle = 'rgba(200,180,90,.45)'; poly(c, [[600, 520], [622, 476], [644, 520]], 'rgba(200,180,90,.45)');
  c.fillStyle = 'rgba(20,20,20,.9)'; c.font = `800 18px ${FONT}`; c.fillText('1', 616, 514);
  poly(c, [[560, 200], [578, 164], [596, 200]], 'rgba(200,180,90,.4)'); c.fillStyle = 'rgba(20,20,20,.9)'; c.font = `800 15px ${FONT}`; c.fillText('2', 572, 195);
  // 척도 (희미하게)
  c.globalAlpha = 0.45; scale(c, 120, 522, 240); c.globalAlpha = 1;
  const out = finish(cv, { vignette: 0.6, noise: 16, blur: 0.8, dark: true }, 66);
  stamp(out.getContext('2d')!, '2026.10.14 ─ 혈흔 반응 검사 · 집무실 중앙 바닥 (장노출)', '도심서 과학수사 · 감식 1');
  return out;
}

const MAKERS: Record<string, () => HTMLCanvasElement> = {
  'gt-scene': photoScene, 'gt-bath': photoBath, 'gt-trophy': photoTrophy, 'gt-base': photoBase, 'gt-underside': photoUnderside, 'gt-luminol': photoLuminol,
};

const cache = new Map<string, string>();
function make(name: string): string {
  const hit = cache.get(name);
  if (hit) return hit;
  const url = (MAKERS[name] ?? photoScene)().toDataURL('image/jpeg', 0.88);
  cache.set(name, url);
  return url;
}

/** 실제 사진 파일 (있으면 그린 사진 대신 쓴다) */
const FILES = import.meta.glob('../assets/evidence/gt-*.{jpg,jpeg,png,webp}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const fileFor = (name: string) => { const k = Object.keys(FILES).find((x) => x.split('/').pop()!.replace(/\.[^.]+$/, '') === name); return k ? FILES[k] : null; };

export function EvidencePhoto({ name, width = 560, alt }: { name: string; width?: number; alt?: string }) {
  const file = fileFor(name);
  const sketch = name.startsWith('gt-trophy-');
  const [src, setSrc] = useState(() => (file ? file : cache.get(name) ?? ''));
  useEffect(() => {
    if (file || src) return;
    // 그리는 데 잠깐 걸리므로 화면을 먼저 그린 뒤 만든다
    const id = window.setTimeout(() => setSrc(make(name)), 0);
    return () => window.clearTimeout(id);
  }, [name, src, file]);
  const frame: CSSProperties = { position: 'relative', width, maxWidth: '100%', aspectRatio: `${W} / ${H}`, background: sketch ? 'transparent' : '#16171a', borderRadius: sketch ? 0 : 3, overflow: 'hidden', ...(sketch ? { boxShadow: 'none' } : {}) };
  return (
    <div className="evidence-photo" style={frame}>
      {src && <img className={sketch ? 'seamless-art' : undefined} src={src} alt={alt ?? name} style={{ width: '100%', height: '100%', objectFit: sketch ? 'contain' : 'cover', display: 'block' }} />}
    </div>
  );
}
