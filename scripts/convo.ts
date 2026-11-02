// 실제 게임처럼 한 턴씩 이어지는 대화로 프롬프트를 점검한다 (2026-10-17 프롬프트 최적화).
// 판(세션)은 design/convo/<이름>.json에 남는다. 앞 답이 다음 턴의 대화 기록이 되고, 인정·진술·자료가 쌓인다.
//   npx tsx scripts/convo.ts new <판> [자료ID...]          새 판 (처음 자료 + 덧붙일 자료)
//   npx tsx scripts/convo.ts say <판> <A|B|C|T> "말" [첨부ID,첨부ID]   용의자(A·B·C) 또는 수사팀(T)에게 말한다
//   npx tsx scripts/convo.ts give <판> 자료ID...            자료를 받은 것으로 친다 (수사팀 결과 도착)
//   npx tsx scripts/convo.ts statement <판> <A|B|C>         진술서를 정리해 본다
//   npx tsx scripts/convo.ts cost                           지금까지 쓴 비용
// 모델은 게임과 같은 Haiku (ANTHROPIC_MODEL로 바꿀 수 있다). 비용은 design/convo/ledger.json에 쌓는다.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED, PERSONS } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import { investigationById } from '../src/data/investigations';
import type { PersonId } from '../src/data/types';
import { runAi, type AiResult } from '../server/aiHandler';
import { buildTalkPrompt, confessesWithoutAdmit, deniesAfterConfession, leakedTimes, leakedWords, repeatsRetracted, sanitizeTalk, type TalkInput } from '../src/ai/talk';
import { phoneCallAsLastMeeting } from '../src/engine/consistency';
import { buildDeskPrompt, DESK_RETRY, deskForbid, heardLines, safeDeskReply, sanitizeDesk } from '../src/ai/desk';
import { ownedSheet } from '../src/ai/team';
import { buildStatementPrompt, mergeStatement, sanitizeStatement, settledTalk, statementBasis, statementMode } from '../src/ai/statement';
import { expandRequest, planRequest } from '../src/engine/investigation';
import { INVESTIGATIONS } from '../src/data/investigations';
import type { AiStatement, ChatMsg } from '../src/engine/state';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const MODEL = process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5';
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: MODEL };
const DIR = 'design/convo';
mkdirSync(DIR, { recursive: true });

/** 100만 토큰당 달러 */
const PRICE: Record<string, { in: number; read: number; write: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, read: 0.01, write: 0.125, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, read: 0.1, write: 2.5, out: 10 },
};
const LEDGER = `${DIR}/ledger.json`;
const ledger = (): { usd: number; calls: number } => (existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { usd: 0, calls: 0 });
function charge(out: AiResult): number {
  const p = PRICE[MODEL] ?? PRICE['claude-sonnet-5-5'];
  const u = out.usage;
  const usd = u ? (u.input * p.in + u.cacheRead * p.read + u.cacheWrite * p.write + u.output * p.out) / 1e6 : 0;
  const l = ledger();
  writeFileSync(LEDGER, JSON.stringify({ usd: l.usd + usd, calls: l.calls + 1 }));
  return usd;
}

interface Session { owned: string[]; chats: Record<'A' | 'B' | 'C', ChatMsg[]>; team: ChatMsg[]; statements: Partial<Record<PersonId, AiStatement>> }
const file = (name: string) => `${DIR}/${name}.json`;
const load = (name: string): Session => JSON.parse(readFileSync(file(name), 'utf8'));
const save = (name: string, s: Session) => writeFileSync(file(name), JSON.stringify(s, null, 1));
let n = Date.now();
const key = () => `m${(n++).toString(36)}`;

async function call(task: 'talk' | 'desk' | 'statement', user: string): Promise<{ text: string; usd: number; ms: number }> {
  const out = await runAi({ task, user }, env);
  return { text: out.text, usd: charge(out), ms: out.ms };
}

const [cmd, name, ...rest] = process.argv.slice(2);

if (cmd === 'new') {
  save(name, { owned: [...new Set([...INITIAL_OWNED, ...rest])], chats: { A: [], B: [], C: [] }, team: [], statements: {} });
  console.log(`새 판 ${name}`);
} else if (cmd === 'give') {
  const s = load(name);
  s.owned = [...new Set([...s.owned, ...rest])];
  save(name, s);
  console.log(`자료 추가: ${rest.join(', ')}`);
} else if (cmd === 'say') {
  const [who, text, att] = rest;
  const s = load(name);
  const owned = new Set(s.owned);
  if (who === 'T') {
    const heard = heardLines(s.statements, owned);
    const input = { text, owned, history: s.team, jobs: [], heard };
    const recent = s.team.slice(-14).map((m) => m.text).join(' ');
    const check = (r: ReturnType<typeof sanitizeDesk>) => {
      const sheet = [ownedSheet(owned), INVESTIGATIONS.map((x) => `${x.label} ${x.topic}`).join(' '), recent, heard.join(' '), text].join('\n');
      return safeDeskReply(r.reply, sheet, deskForbid(owned, [recent, heard.join(' '), text].join('\n'), ownedSheet(owned)));
    };
    let o = await call('desk', buildDeskPrompt(input));
    let r = sanitizeDesk(JSON.parse(o.text));
    let note = '';
    if (!r.start.length && !r.deflect.length && !check(r)) {
      note = `  ⚠ 검사 걸림, 다시 씀. 처음 답: ${r.reply.replace(/\n/g, ' ⏎ ')}\n`;
      o = await call('desk', buildDeskPrompt({ ...input, retry: DESK_RETRY }));
      r = sanitizeDesk(JSON.parse(o.text));
    }
    // 게임처럼: 조사를 맡으면 AI의 말 대신 엔진의 접수 문구를 보인다 (teamChat.applyDesk)
    const plan = r.start.length ? planRequest(r.start, owned, []) : null;
    const shown = plan && plan.status !== 'none' ? plan.text : check(r) ?? '(검사 실패 → 대체 문구)';
    s.team.push({ id: key(), role: 'me', text }, { id: key(), role: 'them', text: shown });
    // 맡은 조사는 바로 도착한 것으로 친다
    const ids = expandRequest(r.start, owned);
    const outs = ids.flatMap((id) => [...investigationById.get(id)!.outputs, ...(investigationById.get(id)!.bonus ?? [])]);
    s.owned = [...new Set([...s.owned, ...outs])];
    save(name, s);
    console.log(`${note}[수사팀 ${o.ms}ms $${o.usd.toFixed(4)}] ${shown.replace(/\n/g, ' ⏎ ')}\n  start=${r.start} deflect=${r.deflect}${outs.length ? ` → 받은 자료 ${outs.join(',')}` : ''}`);
  } else {
    const person = who as 'A' | 'B' | 'C';
    const attached = att ? att.split(',') : undefined;
    const input: TalkInput = { person, text, owned, history: s.chats[person], attached };
    const user = buildTalkPrompt(input);
    let r: ReturnType<typeof sanitizeTalk> | null = null;
    let usd = 0, ms = 0;
    const rejects: string[] = [];
    // 게임처럼 검사에 걸리면 다시 받는다 (최대 3번)
    for (let i = 0; i < 3 && !r; i++) {
      const o = await call('talk', user);
      usd += o.usd; ms += o.ms;
      const raw = JSON.parse(o.text) as { reply: string };
      const why = person === 'C' && phoneCallAsLastMeeting(raw.reply) ? '전화를 마지막 대면으로' : leakedTimes(input, raw.reply).length ? `숨긴 시각 ${leakedTimes(input, raw.reply)}` : leakedWords(input, raw.reply, sanitizeTalk(raw, person, owned, text).admit).length ? `숨긴 낱말 ${leakedWords(input, raw.reply, sanitizeTalk(raw, person, owned, text).admit)}` : deniesAfterConfession(input, raw.reply) ? '자백 뒤 부인' : /(GT-[ER]\d+|[A-C]-(Q|R|F)\d+[a-z]?|X-L\d+)/.test(raw.reply) ? '내부 ID' : repeatsRetracted(input, raw.reply).length ? `거둔 말 ${repeatsRetracted(input, raw.reply)}` : confessesWithoutAdmit(input, raw.reply, sanitizeTalk(raw, person, owned, text).admit) ? '근거 없는 자백' : '';
      if (why) { rejects.push(`${why}: ${raw.reply}`); continue; }
      r = sanitizeTalk(raw, person, owned, text);
    }
    if (!r) { console.log(`[${PERSONS[person].name}] 세 번 모두 검사에 걸림\n  ${rejects.join('\n  ')}`); process.exit(0); }
    s.chats[person].push({ id: key(), role: 'me', text, ...(attached ? { attached } : {}) }, { id: key(), role: 'them', text: r.reply, kind: r.admit.length ? 'success' : r.record.length ? 'fact' : 'written', facts: r.record });
    const base = STATEMENT_FORMS[person].statementId;
    const fresh = [...r.record, ...r.give, ...r.admit, ...((r.record.length || r.admit.length) ? [base] : [])];
    s.owned = [...new Set([...s.owned, ...fresh])];
    save(name, s);
    console.log(`${rejects.map((x) => `  ⚠ 검사 걸림: ${x}\n`).join('')}[${PERSONS[person].name} ${ms}ms $${usd.toFixed(4)}] ${r.reply}\n  record=${r.record} give=${r.give} admit=${r.admit} basis=${r.basis}`);
  }
} else if (cmd === 'statement') {
  const person = rest[0] as PersonId;
  const s = load(name);
  const owned = new Set(s.owned);
  const prev = s.statements[person];
  const input = { person, owned, chat: s.chats[person as 'A'], prev };
  const mode = statementMode(input);
  const o = await call('statement', buildStatementPrompt({ ...input, mode }));
  const upto = settledTalk(input.chat).length;
  const st = mode === 'delta' && prev ? mergeStatement(prev, JSON.parse(o.text), person, owned, upto) : sanitizeStatement(JSON.parse(o.text), person, owned, upto);
  s.statements[person] = { ...st, basis: statementBasis(person, owned) };
  save(name, s);
  console.log(`[진술서 ${PERSONS[person].name} ${mode} $${o.usd.toFixed(4)}]`);
  for (const sec of st.sections) {
    console.log(`■ ${sec.title}`);
    for (const l of sec.lines) console.log(`  (${l.kind}) ${l.text}${l.was ? `  ← 전: ${l.was}` : ''}`);
  }
} else if (cmd === 'cost') {
  const l = ledger();
  console.log(`지금까지 ${l.calls}회, $${l.usd.toFixed(3)}`);
} else {
  console.log('명령: new | say | give | statement | cost');
}
