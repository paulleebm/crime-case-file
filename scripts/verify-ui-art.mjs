import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, devices } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:5173';
const output = path.resolve(process.argv[3] ?? 'dev-logs/ui-refresh-local');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.route('**/api/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
await context.addInitScript(() => { Element.prototype.requestFullscreen = async () => {}; });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const captures = [];
await page.goto(base);
await page.getByRole('button', { name: '시작하기', exact: true }).waitFor();
let fixture;
const fixturePath = path.resolve('dev-logs/ui-art-fixture.json');
if (base.includes('127.0.0.1')) {
  fixture = await page.evaluate(async () => {
    const engine = await import('/src/engine/state.tsx');
    const data = await import('/src/data/case.ts');
    const state = engine.newGame();
    state.owned = [...new Set([...state.owned, ...data.EVIDENCE.map(item => item.id)])];
    state.report = { culprit: data.CULPRIT, answers: Object.fromEntries(data.REPORT_QUESTIONS.map(question => [question.id, question.model])) };
    return { state, questions: data.REPORT_QUESTIONS.map(question => question.id) };
  });
  await fs.writeFile(fixturePath, JSON.stringify(fixture, null, 2));
} else {
  fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'));
}
async function capture(name) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
    const sources = [...document.querySelectorAll('svg image')].map(image => image.getAttribute('href'));
    for (const element of document.querySelectorAll('.seal-impression')) {
      sources.push(...[...getComputedStyle(element).maskImage.matchAll(/url\("?([^"\)]+)"?\)/g)].map(match => match[1]));
    }
    await Promise.all(sources.filter(Boolean).map(async source => { const image = new Image(); image.src = source; await image.decode(); }));
  });
  const metrics = await page.evaluate(() => ({
    viewport: [innerWidth, innerHeight],
    bodyOverflow: document.documentElement.scrollWidth > innerWidth,
    brokenImages: [...document.images].filter(image => !image.complete || image.naturalWidth === 0).map(image => image.src),
    images: [...document.images].map(image => ({ src: image.src, width: image.naturalWidth, height: image.naturalHeight })),
    textures: [1, 2, 3, 4, 5].map(step => getComputedStyle(document.documentElement).getPropertyValue(`--tex-c${step}`).trim()),
    scene: (() => { const image = document.querySelector('.truth-img'); if (!image) return null; const rect = image.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, mask: getComputedStyle(image).maskImage }; })(),
  }));
  assert.equal(metrics.brokenImages.length, 0, name + ': broken images');
  if (name !== 'screen-guard') assert.equal(metrics.bodyOverflow, false, name + ': horizontal overflow');
  assert.ok(metrics.textures.every(texture => texture === 'none'), name + ': unexpected texture');
  await page.screenshot({ path: path.join(output, name + '.png') });
  captures.push({ name, ...metrics });
}
async function openSaved(tab, result = false) {
  const state = structuredClone(fixture.state);
  if (tab) { state.tabs = [{ key: 'qa', ...tab }]; state.active = 'qa'; }
  if (result) { state.screen = 'result'; state.result = { grade: 'perfect', culpritOk: true, correct: Object.fromEntries(fixture.questions.map(key => [key, true])) }; }
  await page.goto(base);
  await page.getByRole('button', { name: '시작하기', exact: true }).waitFor();
  await page.evaluate(state => localStorage.setItem('gold-trophy-save-v1', JSON.stringify(state)), state);
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await page.getByRole('button', { name: '이어서 하기', exact: true }).click();
  await page.locator(result ? '.result' : '.hub').waitFor();
}
try {
  await capture('title');
  await page.getByRole('button', { name: '시작하기', exact: true }).click();
  await capture('episodes');
  for (const [name, tab] of [
    ['brief', { type: 'doc', ref: 'BRIEF' }],
    ['junseo', { type: 'person', ref: 'A' }],
    ['mina', { type: 'person', ref: 'B' }],
    ['taejun', { type: 'person', ref: 'C' }],
    ['team', { type: 'team' }],
    ['map', { type: 'doc', ref: 'GT-MAP' }],
    ['trophy-report', { type: 'doc', ref: 'GT-E11' }],
    ['prints-report', { type: 'doc', ref: 'GT-E16' }],
    ['report', { type: 'report' }],
  ]) { await openSaved(tab); await capture(name); }
  await openSaved(null, true);
  await capture('result');
  await page.getByRole('button', { name: '진상 해설 보기' }).click();
  for (let index = 1; index <= 13; index++) {
    await capture(`truth-${String(index).padStart(2, '0')}`);
    await page.getByRole('button', { name: '다음 ▶', exact: true }).click();
  }
  await capture('truth-summary');
  await page.getByRole('button', { name: '사건 이후', exact: true }).click();
  await capture('afterword');
  for (const [width, height] of [[1280, 720], [1024, 768], [720, 460]]) {
    await page.setViewportSize({ width, height });
    await openSaved({ type: 'person', ref: 'B' });
    await capture(`mina-${width}`);
  }
  await page.setViewportSize({ width: 680, height: 440 });
  await page.locator('.screen-guard .guard-art').evaluate(image => image.decode());
  await capture('screen-guard');
  const mobile = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await mobile.newPage();
  await phone.goto(base);
  await phone.locator('.guard-art').waitFor();
  await phone.evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
  await phone.screenshot({ path: path.join(output, 'mobile.png') });
  assert.equal(await phone.locator('.hub').count(), 0);
  assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await mobile.close();
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ base, syntheticState: true, aiCalls: false, errors, captures }, null, 2));
  console.log(JSON.stringify({ base, screens: captures.length + 1, errors, output }));
} finally {
  await browser.close();
}
