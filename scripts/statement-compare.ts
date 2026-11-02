import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { INITIAL_OWNED, PERSONS } from '../src/data/case';
import type { PersonId } from '../src/data/types';
import type { AiStatement, ChatMsg } from '../src/engine/state';
import { buildStatementPrompt, mergeStatement, sanitizeStatement, settledTalk, statementBasis, statementMode, type StatementMode } from '../src/ai/statement';
import { runAi, type AiEnv } from '../server/aiHandler';

// 진술서 정리 방식 비교. 한 판의 기록에서 진술서를 정리한 시점마다 그때의 대화·자료를 되살려,
// 같은 대화로 "늘 전체 다시 쓰기"(예전 방식)와 "바뀐 항목만, 인정·철회 때 전체"(지금 방식)를 나란히 돌린다.
//   npx tsx scripts/statement-compare.ts <run>             Cloud Logging에서 그 판을 읽어 비교 (API 비용이 든다)
//   npx tsx scripts/statement-compare.ts <run> --dry       API를 부르지 않고 시점·방식·프롬프트 길이만 본다 (무료)
//   npx tsx scripts/statement-compare.ts <run> --limit 10  앞의 10번만
//   npx tsx scripts/statement-compare.ts <run> --file x.json  내려받은 기록(gcloud JSON 또는 play.jsonl)으로
// 결과: dev-logs/statement-compare/<run>.md (호출별 토큰·비용, 인물별 마지막 진술서 두 개)

const args = process.argv.slice(2);
const flag = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const dry = args.includes('--dry');
const limit = Number(flag('--limit')) || Infinity;
const file = flag('--file');
const run = args.find((a, i) => !a.startsWith('--') && !['--limit', '--file'].includes(args[i - 1]));
if (!run) throw new Error('판 ID(run)를 주세요');

type Ev = Record<string, any> & { type: string; at: number };
function load(): Ev[] {
  let raw: any[];
  if (file) {
    const text = fs.readFileSync(file, 'utf8');
    raw = text.trimStart().startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } else {
    const filter = `jsonPayload.kind="play" AND jsonPayload.run="${run}"`;
    raw = JSON.parse(execSync(`gcloud logging read "${filter.replace(/"/g, '\\"')}" --project crime-case-file --freshness=30d --order=asc --limit=100000 --format=json`, { maxBuffer: 1 << 30, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } }));
  }
  return raw.map((x) => x.jsonPayload ?? x).filter((e) => e.run === run).map((e) => ({ ...e, at: typeof e.at === 'number' ? e.at : Date.parse(e.at) })).sort((a, b) => a.at - b.at);
}

// ── 그때의 대화·자료 되살리기 ──
type Point = { at: number; person: PersonId; owned: Set<string>; chat: ChatMsg[]; usage?: Record<string, number> };
const points: Point[] = [];
{
  let owned = new Set<string>(INITIAL_OWNED);
  const chats: Record<PersonId, ChatMsg[]> = { A: [], B: [], C: [] };
  let last: PersonId | null = null;
  for (const e of load()) {
    // 같은 기록 안에서 새 게임을 시작하면 처음으로 되돌린다
    if ((e.type === 'start' || e.type === 'resume') && typeof e.owned === 'number' && e.owned < owned.size) { owned = new Set(INITIAL_OWNED); chats.A = []; chats.B = []; chats.C = []; }
    if (e.type === 'backfill_state') owned = new Set([...owned, ...e.owned]);
    if (e.type === 'team_result') for (const id of e.docs) owned.add(id);
    if (e.type === 'reveal') for (const id of e.ids) owned.add(id);
    if (e.type === 'chat' && e.person in chats) {
      chats[e.person as PersonId].push({ id: e.id ?? String(e.at), role: e.role, text: e.text ?? '', ...(e.sub ? { sub: e.sub } : {}), ...(e.hint ? { hint: true } : {}), ...(e.attached ? { attached: e.attached } : {}) } as ChatMsg);
      if (e.role === 'them') last = e.person;
    }
    if (e.type === 'ai' && e.task === 'statement' && e.ok && last) points.push({ at: e.at, person: last, owned: new Set(owned), chat: [...chats[last]], usage: e.usage });
  }
}
const todo = points.slice(0, limit);
console.log(`진술서 정리 ${points.length}번${todo.length < points.length ? ` 가운데 앞 ${todo.length}번` : ''}`);

// ── 두 방식으로 돌리기 ──
const env: AiEnv = (() => {
  const t = fs.readFileSync('.env.local', 'utf8');
  const get = (k: string) => t.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim();
  return { ANTHROPIC_API_KEY: get('ANTHROPIC_API_KEY'), ANTHROPIC_MODEL: get('ANTHROPIC_MODEL') };
})();
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const usd = (u?: Record<string, number>) => (u ? Object.entries(PRICE).reduce((a, [k, p]) => a + (u[k] ?? 0) * p, 0) / 1e6 : 0);

type Chain = { name: string; fixed?: StatementMode; prev: Partial<Record<PersonId, AiStatement>>; total: number; out: number };
const chains: Chain[] = [{ name: '예전: 늘 전체', fixed: 'full', prev: {}, total: 0, out: 0 }, { name: '지금: 바뀐 항목만', prev: {}, total: 0, out: 0 }];
const rows: string[] = ['| # | 시각 | 인물 | ' + chains.map((c) => `${c.name} (방식 · 출력 · $)`).join(' | ') + ' |', '|---|---|---|' + chains.map(() => '---').join('|') + '|'];

for (const [i, pt] of todo.entries()) {
  const cells: string[] = [];
  for (const c of chains) {
    const prev = c.prev[pt.person];
    const input = { person: pt.person, owned: pt.owned, chat: pt.chat, prev };
    const mode = c.fixed ?? statementMode(input);
    const user = buildStatementPrompt({ ...input, mode });
    if (dry) {
      // 정리 결과 대신 자리표시를 남겨, 다음 시점의 방식(전체/바뀐 항목만)이 실제처럼 정해지게 한다
      c.prev[pt.person] = { sections: [{ title: '(dry)', lines: [{ text: '-', kind: 'claim' }] }], upto: settledTalk(pt.chat).length, at: pt.at, basis: statementBasis(pt.person, pt.owned) };
      cells.push(`${mode} · 프롬프트 ${user.length}자`);
      continue;
    }
    const r = await runAi({ task: 'statement', user }, env);
    const upto = settledTalk(pt.chat).length;
    const st = mode === 'delta' && prev ? mergeStatement(prev, JSON.parse(r.text), pt.person, pt.owned, upto) : sanitizeStatement(JSON.parse(r.text), pt.person, pt.owned, upto);
    c.prev[pt.person] = { ...st, basis: statementBasis(pt.person, pt.owned) };
    c.total += usd(r.usage); c.out += r.usage?.output ?? 0;
    cells.push(`${mode} · ${r.usage?.output ?? '-'} · $${usd(r.usage).toFixed(4)}`);
  }
  rows.push(`| ${i + 1} | ${new Date(pt.at).toLocaleTimeString('en-GB', { timeZone: 'Asia/Seoul' })} | ${PERSONS[pt.person].name} | ${cells.join(' | ')} |`);
  console.log(rows[rows.length - 1]);
}

const show = (st?: AiStatement) => (st ? st.sections.flatMap((s) => [`**${s.title}**`, ...s.lines.map((l) => `- ${l.text}${l.kind !== 'claim' ? ` _(${l.kind}${l.was ? `: ${l.was}` : ''})_` : ''}`)]).join('\n') : '(없음)');
const md = [
  `# 진술서 정리 방식 비교 · ${run}`, '',
  `기록에 남은 실제 비용 (이 ${todo.length}번): $${todo.reduce((a, p) => a + usd(p.usage), 0).toFixed(3)}`,
  ...(dry ? ['', '(--dry: API를 부르지 않았다)'] : chains.map((c) => `- ${c.name}: $${c.total.toFixed(3)} · 출력 ${c.out} 토큰`)),
  '', ...rows, '',
  ...(dry ? [] : (['A', 'B', 'C'] as PersonId[]).filter((p) => chains.some((c) => c.prev[p])).flatMap((p) => [`## ${PERSONS[p].name}`, '', ...chains.flatMap((c) => [`### ${c.name}`, '', show(c.prev[p]), ''])])),
];
const out = path.join('dev-logs', 'statement-compare', `${run}${dry ? '-dry' : ''}.md`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, md.join('\n'));
console.log(`\n${dry ? '' : chains.map((c) => `${c.name} $${c.total.toFixed(3)}`).join(' · ') + '\n'}→ ${out}`);
