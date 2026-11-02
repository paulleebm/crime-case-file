// 진술서 모델 비교: model-talk-compare.ts가 남긴 대화 전문을 그대로 쓰고, 턴마다 진술서를 정리하는 일만 모델별로 돌린다.
// 게임처럼 매 턴 뒤에 정리하고, 인정·철회가 없으면 바뀐 항목만 다시 쓴다(writeStatement와 같은 흐름).
// 실행: npx tsx scripts/statement-model-compare.ts <대화 전문.md> <모델...>
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED, PERSONS } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import { runAi } from '../server/aiHandler';
import { buildStatementPrompt, mergeStatement, sanitizeStatement, settledTalk, statementBasis, statementMode } from '../src/ai/statement';
import type { AiStatement, ChatMsg } from '../src/engine/state';
import type { PersonId } from '../src/data/types';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
if (!process.env.OPENAI_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^OPENAI_API_KEY=(.+)$/m);
  if (m) process.env.OPENAI_API_KEY = m[1].trim();
}
if (!process.env.GEMINI_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^GEMINI_API_KEY=(.+)$/m);
  if (m) process.env.GEMINI_API_KEY = m[1].trim();
}
// 모델 이름으로 공급자 하나만 고른다 (다른 공급자로 넘어가지 않게)
const envFor = (model: string) => model.startsWith('gpt-') ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY, OPENAI_MODEL: model }
  : /^(gemini|gemma)/.test(model) ? { GEMINI_API_KEY: process.env.GEMINI_API_KEY, GEMINI_MODEL: model }
  : { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: model };
/** 무료 등급의 요청 수 제한(429)에 걸리면 기다렸다가 다시 부른다 */
async function call(body: { task: 'talk' | 'desk' | 'statement'; user: string }, env: ReturnType<typeof envFor>) {
  for (let i = 0; ; i++) {
    try { return await runAi(body, env); } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (i >= 5 || !/429|quota|RESOURCE_EXHAUSTED|rate|overloaded|503|UNAVAILABLE/i.test(`${(e as { status?: number }).status} ${msg}`)) throw e;
      await new Promise((r) => setTimeout(r, 15000 * (i + 1)));
    }
  }
}
const [src, ...models] = process.argv.slice(2);
const PRICE: Record<string, { in: number; read: number; write: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, read: 0.01, write: 0.125, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, read: 0.1, write: 2.5, out: 10 },
  'gpt-6-luna': { in: 0.1, read: 0.01, write: 0, out: 0.5 },
  'gpt-5.6-luna': { in: 0.2, read: 0.02, write: 0, out: 1.2 },
  'gpt-6.1-sol': { in: 2, read: 0.1, write: 0, out: 10 },
  'gpt-5.4-mini': { in: 0.75, read: 0.075, write: 0, out: 4.5 },
};

// ── 대화 전문 읽기 ──
type Turn = { q: string; attached?: string[]; reply: string; reveals: string[] };
const byName = new Map(Object.entries(PERSONS).map(([id, p]) => [p.name, id as PersonId]));
const turns: Partial<Record<PersonId, Turn[]>> = {};
let cur: PersonId | undefined;
for (const line of readFileSync(src, 'utf8').split('\n')) {
  const h = line.match(/^## (.+)$/);
  if (h) { cur = byName.get(h[1].trim()); continue; }
  if (!cur) continue;
  const list = (turns[cur] ??= []);
  const q = line.match(/^\*\*형사:\*\* (.*?)(?:\s+`\[제시: (.+)\]`)?$/);
  if (q) { list.push({ q: q[1], attached: q[2]?.split(', '), reply: '', reveals: [] }); continue; }
  const a = line.match(/^\*\*(.+?):\*\* (.*)$/);
  if (a && byName.get(a[1]) === cur) { list[list.length - 1].reply = a[2]; continue; }
  if (line.startsWith('> ') && list.length) {
    const t = list[list.length - 1];
    for (const k of ['기록', '건넴', '인정']) {
      const m = line.match(new RegExp(`${k} ([A-Z0-9,-]+)`));
      if (m) t.reveals.push(...m[1].split(','));
    }
  }
}

const md: string[] = [`# 진술서 모델 비교`, '', `대화: \`${src}\``, ''];
const show = (st: AiStatement) => st.sections.flatMap((s) => [`**${s.title}**`, ...s.lines.map((l) => `- ${l.text}${l.kind !== 'claim' ? ` _(${l.kind}${l.was ? `: 앞서 "${l.was}"` : ''})_` : ''}`), '']);

for (const model of models) {
  const env = envFor(model);
  const tot = { in: 0, read: 0, write: 0, out: 0, ms: [] as number[], fail: 0 };
  md.push(`## ${model}`, '');
  for (const [person, list] of Object.entries(turns) as [PersonId, Turn[]][]) {
    const owned = new Set<string>(INITIAL_OWNED);
    const chat: ChatMsg[] = [];
    let prev: AiStatement | undefined;
    const log: string[] = [];
    for (const [i, t] of list.entries()) {
      for (const id of t.attached ?? []) owned.add(id);
      for (const id of t.reveals) owned.add(id);
      if (t.reveals.length) owned.add(STATEMENT_FORMS[person].statementId);
      chat.push({ id: `q${i}`, role: 'me', text: t.q, ...(t.attached ? { attached: t.attached } : {}) }, { id: `a${i}`, role: 'them', text: t.reply });
      const input = { person, owned, chat, prev };
      const mode = statementMode(input);
      try {
        const out = await call({ task: 'statement', user: buildStatementPrompt({ ...input, mode }) }, env);
        const upto = settledTalk(chat).length;
        const st = mode === 'delta' && prev ? mergeStatement(prev, JSON.parse(out.text), person, owned, upto) : sanitizeStatement(JSON.parse(out.text), person, owned, upto);
        prev = { ...st, basis: statementBasis(person, owned) };
        const u = out.usage;
        if (u) { tot.in += u.input; tot.read += u.cacheRead; tot.write += u.cacheWrite; tot.out += u.output; }
        tot.ms.push(out.ms);
        log.push(`${i + 1}턴 ${mode === 'delta' ? '바뀐 항목만' : '전체'} ${(out.ms / 1000).toFixed(1)}초 출력 ${u?.output}`);
      } catch (e) {
        tot.fail++;
        log.push(`${i + 1}턴 실패: ${String(e).slice(0, 80)}`);
      }
      console.log(model, person, i + 1);
    }
    md.push(`### ${PERSONS[person].name}`, '', `> ${log.join(' · ')}`, '', ...(prev ? show(prev) : ['(진술서 없음)', '']));
  }
  const p = PRICE[model];
  const usd = p ? (tot.in * p.in + tot.read * p.read + tot.write * p.write + tot.out * p.out) / 1e6 : NaN;
  const ms = [...tot.ms].sort((a, b) => a - b);
  const summary = `정리 ${ms.length}회 · 실패 ${tot.fail} · 중앙값 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}초 · 최대 ${(ms[ms.length - 1] / 1000).toFixed(1)}초 · 출력 ${tot.out} · 비용 약 $${usd.toFixed(4)}`;
  md.push(`> **${model} 합계:** ${summary}`, '');
  console.log(model, summary);
}
writeFileSync(process.env.OUT ?? 'design/model-eval-2026-10-17-talk/statement-compare.md', md.join('\n'));
