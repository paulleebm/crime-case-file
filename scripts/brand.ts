// 사이트 아이콘(파비콘·앱 아이콘)과 링크 미리보기 이미지(og-image)를 만든다.
// 미리보기는 게임 표지와 같은 연필 선 생성기(sketch.ts)와 표지 그림(FileStack, Seal)을 그대로 쓴다.
// 실행: npx tsx scripts/brand.tsx  → public/ 에 파일을 쓴다

import fs from 'node:fs';
import path from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chromium } from 'playwright';
import { CASE_SUBTITLE, CASE_TITLE } from '../src/data/case';
import { GAME_TITLE_EN } from '../src/data/episodes';
import { PencilDefs, Seal } from '../src/sketch/components';
import { arc, boxStrokes, hashSeed, hatch, line, rng, type Stroke } from '../src/sketch/sketch';
import { FileStack } from '../src/ui/CoverArt';

const OUT = path.resolve(import.meta.dirname, '../public');
const PAPER = '#f3f2ee', INK = '#1f1f1f';
const LEAD = '#3b3b3b'; // 아이콘 색: 먹색보다 살짝 옅은 연필심 회색

const paths = (strokes: Stroke[]) =>
  strokes.map((s) => `<path d="${s.d}" stroke-width="${s.w.toFixed(2)}" opacity="${s.op.toFixed(2)}" fill="none"/>`).join('');

/** 아이콘: 연필로 칠한 서류철에 물음표를 뚫어 낸다. 배경은 투명.
 *  16px에서도 읽히도록 면은 거의 꽉 채우되, 빗금을 촘촘히 겹쳐 칠한 결과 모서리를 넘겨 덧그은 외곽선으로 연필 느낌을 낸다.
 *  dark=true면 브라우저가 어두운 테마일 때 종이색으로 바꿔 탭 막대에 묻히지 않게 한다(SVG 파비콘만 해당). */
function iconSvg(size = 64, opts: { bg?: string; dark?: boolean } = {}) {
  const r = rng(hashSeed('site-icon'));
  const pad = opts.bg ? 9 : 0; // 배경을 까는 앱 아이콘은 가장자리 여백을 둔다
  const s = (64 - pad * 2) / 64;

  // 서류철 꼭짓점: 색인 탭 → 윗변 → 오른쪽 아래 → 왼쪽 아래
  const pts: [number, number][] = [[6, 10], [24, 10], [29.5, 16], [58, 16], [58, 56], [6, 56]];
  const shape = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x + (r() - 0.5) * 1.2).toFixed(1)} ${(y + (r() - 0.5) * 1.2).toFixed(1)}`).join('') + 'Z';
  // 칠: 옅은 바탕 위에 굵은 빗금을 겹쳐 그어 결을 남긴다
  const shade: Stroke[] = [];
  hatch(shade, r, 4, 8, 56, 50, 2.3, { w: 3.4, op: 1, j: 0.5, os: 1 });
  const edge: Stroke[] = [];
  pts.forEach(([x1, y1], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    line(edge, r, x1, y1, x2, y2, { os: 2.6, w: 1.9, j: 0.6, op: 1.1 });
  });

  // 물음표: 고리는 호, 꼬리는 직선, 둘 다 두 번 긋는다
  const q: Stroke[] = [];
  arc(q, r, 32, 31.5, 6.6, Math.PI * 1.02, Math.PI * 2.42, { os: 1.4, w: 5.2, j: 0.55 });
  line(q, r, 34.2, 37.6, 32.2, 44.2, { os: 0.5, w: 5.2, j: 0.45 });
  line(q, r, 31.4, 51.2, 32.6, 51.8, { os: 0.4, w: 6, j: 0.3 });

  const style = opts.dark
    ? `<style>.f{fill:${LEAD}}.s{stroke:${LEAD}}@media (prefers-color-scheme:dark){.f{fill:${PAPER}}.s{stroke:${PAPER}}}</style>`
    : '';
  const full = (xs: Stroke[]) => xs.map((x) => ({ ...x, op: 1 }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
${style}<defs><clipPath id="c"><path d="${shape}"/></clipPath>
<mask id="q" maskUnits="userSpaceOnUse" x="-8" y="-8" width="80" height="80"><rect x="-8" y="-8" width="80" height="80" fill="#fff"/>
<g stroke="#000" stroke-linecap="round">${paths(full(q))}</g></mask></defs>
${opts.bg ? `<rect width="64" height="64" fill="${opts.bg}"/>` : ''}
<g transform="translate(${pad} ${pad}) scale(${s})" mask="url(#q)">
<path class="f" fill="${LEAD}" opacity="0.72" d="${shape}"/>
<g class="s" stroke="${LEAD}" stroke-linecap="round" clip-path="url(#c)">${paths(shade)}</g>
<g class="s" stroke="${LEAD}" stroke-linecap="round">${paths(edge)}</g>
</g>
</svg>`;
}

/** 링크 미리보기 1200×630. 게임 표지(Title)를 가로형으로 옮긴 것 */
function ogHtml() {
  const W = 1200, H = 630, M = 34;
  const frame = paths(boxStrokes(W - M * 2, H - M * 2, hashSeed('og-frame'), 'double'));
  const divider: Stroke[] = [];
  line(divider, rng(7), 0, 0.5, W - M * 2 - 120, 0.5, { os: 3, w: 0.7, op: 0.5 });
  const logo = iconSvg(36);
  const art = renderToStaticMarkup(h(FileStack, { width: 420 }));
  const seal = renderToStaticMarkup(h(Seal, { text: '미해결', size: 104 }));
  const defs = renderToStaticMarkup(h(PencilDefs));
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@500;700;900&family=Nanum+Gothic+Coding&display=block" rel="stylesheet">
<style>
:root { --ink:${INK}; --ink-2:#4a4a4a; --ink-3:#7a7a7a;
  --noise: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 .07 0'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>"); }
* { box-sizing: border-box; margin: 0; }
html, body { width:${W}px; height:${H}px; overflow:hidden; }
body { background:${PAPER} var(--noise); color:var(--ink); font-family:'IBM Plex Sans KR', sans-serif; position:relative; }
svg path, svg line { stroke: var(--ink); stroke-linecap: round; }
.frame { position:absolute; left:${M}px; top:${M}px; overflow:visible; }
.inner { position:absolute; left:${M}px; top:${M}px; width:${W - M * 2}px; height:${H - M * 2}px; padding:34px 60px 0; }
.top { display:flex; align-items:center; gap:14px; font:15px 'Nanum Gothic Coding', monospace; color:var(--ink-3); }
.top .en { margin-left:auto; letter-spacing:.12em; }
.rule { display:block; margin:16px 0 0; overflow:visible; }
.main { display:flex; align-items:center; gap:34px; margin-top:34px; }
.text { flex:1; }
.kicker { font:17px 'Nanum Gothic Coding', monospace; color:var(--ink-3); letter-spacing:.3em; margin-bottom:16px; }
h1 { font:900 92px/1.08 'Noto Serif KR', serif; letter-spacing:.06em; }
.lead { font:500 21px/1.75 'Noto Serif KR', serif; color:var(--ink-2); margin-top:24px; }
.art { position:relative; width:420px; }
.seal-wrap { position:absolute; right:-6px; top:-30px; transform:rotate(-12deg); }
.seal { position:relative; display:inline-flex; align-items:center; justify-content:center; font:700 23px 'Noto Serif KR', serif; letter-spacing:.04em; }
.seal-wrap .seal { background:${PAPER}; border-radius:50%; }
.sk-svg { position:absolute; left:0; top:0; overflow:visible; }
.ep { position:absolute; left:60px; right:60px; bottom:30px; display:flex; align-items:baseline; gap:14px; font:15px 'Nanum Gothic Coding', monospace; color:var(--ink-3); }
.ep b { font:700 19px 'Noto Serif KR', serif; color:var(--ink); }
</style></head><body>${defs}
<svg class="frame" width="${W - M * 2}" height="${H - M * 2}"><g filter="url(#pencil)">${frame}</g></svg>
<div class="inner">
  <div class="top">${logo}<span>중부경찰서 강력2팀 · 보관 기록</span><span class="en">${GAME_TITLE_EN}</span></div>
  <svg class="rule" width="${W - M * 2 - 120}" height="2"><g filter="url(#pencil)">${paths(divider)}</g></svg>
  <div class="main">
    <div class="text">
      <div class="kicker">다시 펼치는 기록</div>
      <h1>미해결<br>사건 파일</h1>
      <p class="lead">진술과 기록 사이의 어긋남을 찾아 다시 맞춰라.</p>
    </div>
    <div class="art">${art}<span class="seal-wrap">${seal}</span></div>
  </div>
  <div class="ep"><span>EP.01</span><b>${CASE_TITLE}</b><span>· ${CASE_SUBTITLE}</span></div>
</div></body></html>`;
}

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'favicon.svg'), iconSvg(64, { dark: true }));
fs.writeFileSync(path.join(OUT, 'logo.svg'), iconSvg());

const browser = await chromium.launch();
const page = await browser.newPage();
const shoot = async (html: string, w: number, h: number, file: string, transparent = false) => {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, file), omitBackground: transparent });
};
const icon = (svg: string) => `<html><body style="margin:0;background:transparent">${svg}</body></html>`;

await shoot(icon(iconSvg(32)), 32, 32, 'favicon-32.png', true);
await shoot(icon(iconSvg(180, { bg: PAPER })), 180, 180, 'apple-touch-icon.png'); // iOS는 투명을 검게 칠한다
await shoot(icon(iconSvg(192, { bg: PAPER })), 192, 192, 'icon-192.png');
await shoot(icon(iconSvg(512, { bg: PAPER })), 512, 512, 'icon-512.png');
await shoot(ogHtml(), 1200, 630, 'og-image.png');
await browser.close();
console.log('brand assets →', OUT);
