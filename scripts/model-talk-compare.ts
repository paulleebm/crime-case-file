// 모델 비교: 같은 형사 질문을 용의자 3명·수사팀과 여러 턴 이어서 주고받고 대화 전문을 남긴다.
// 실행: npx tsx scripts/model-talk-compare.ts claude-haiku-5-5 claude-sonnet-5-5
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED, PERSONS } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import { runAi } from '../server/aiHandler';
import { buildTalkPrompt, sanitizeTalk } from '../src/ai/talk';
import { buildDeskPrompt, sanitizeDesk } from '../src/ai/desk';
import type { ChatMsg } from '../src/engine/state';
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

type Turn = { text: string; attached?: string[]; add?: string[] };
const SUSPECTS: { person: PersonId; turns: Turn[] }[] = [
  { person: 'A', turns: [
    { text: '발견 당시 상황 좀 설명해 주시죠.' },
    { text: '집무실에는 왜 올라가셨어요? 그 전에는 어디 계셨고요?' },
    { text: '아버님과 마지막으로 주고받은 문자를 보여 주실 수 있나요?' },
    { text: '카드가 두 번 찍혔네요? 8시 45분에 들어간 건 누구죠?', attached: ['GT-E07'], add: ['GT-E07'] },
    { text: '트로피를 판 돈은 어디에 쓰려고 했어요?' },
    { text: '솔직히 아버님 돌아가시면 이득 보는 사람은 준서 씨 아닌가요?' },
  ] },
  { person: 'B', turns: [
    { text: '그날 밤 무슨 일을 하셨는지 처음부터 말해 주세요.' },
    { text: '집무실에 들어갔을 때 회장님은 계셨나요?' },
    { text: '트로피는 누가 집어서 누구 손에 넘겼나요? 피나 젖은 흔적은 없었어요?' },
    { text: '준서 씨와 주고받은 메시지를 직접 보여 주세요.' },
    { text: '계약 해지 얘기가 있었다던데, 회장님께 서운한 마음은 없었어요?' },
    { text: '이 감식 결과 보시면, 바닥을 닦은 흔적이 있대요. 짚이는 거 없어요?', attached: ['GT-E19'], add: ['GT-E19'] },
  ] },
  { person: 'C', turns: [
    { text: '그날 회장님을 왜 만나셨죠?' },
    { text: '몇 시에 들어가서 몇 시에 나오셨어요?' },
    { text: '정기 보고였다면서요? 이건 뭡니까?', attached: ['GT-E13'], add: ['GT-E13'] },
    { text: '트로피에 손댄 적 없다고 하셨죠. 이 지문은 어떻게 설명하실 겁니까?', attached: ['GT-E17'], add: ['GT-E16', 'GT-E17'] },
    { text: '9시 10분 문자는 8시 48분에 회장님 휴대폰에서 예약된 거예요. 그때 준서 씨와 민아 씨는 매입점에 있었고요. 그 방에 남은 건 당신뿐입니다.', attached: ['GT-E15', 'GT-E10'], add: ['GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15'] },
    { text: '왜 그러셨어요? 처음부터 말씀해 보세요.' },
  ] },
];
const DESK: string[] = [
  '피해자 휴대폰 통화 기록 요청합니다.',
  '응 그것도 해줘. 문자 내역도.',
  '매입점 CCTV 볼 수 있나요?',
  '태준 핸드폰도 좀 털어봐.',
  '범인 누구 같아요?',
  '고생 많으세요 ㅎㅎ 부검 결과는 언제 나와요?',
];

// 1M 토큰당 USD (2026-10-17 요금표)
const PRICE: Record<string, { in: number; read: number; write: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, read: 0.01, write: 0.125, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, read: 0.1, write: 2.5, out: 10 },
  'gpt-6-luna': { in: 0.1, read: 0.01, write: 0, out: 0.5 },
  'gpt-5.6-luna': { in: 0.2, read: 0.02, write: 0, out: 1.2 },
  'gpt-6.1-sol': { in: 2, read: 0.1, write: 0, out: 10 },
  'gpt-5.4-mini': { in: 0.75, read: 0.075, write: 0, out: 4.5 },
};

const models = process.argv.slice(2).length ? process.argv.slice(2) : ['claude-haiku-5-5'];
const dir = 'design/model-eval-2026-10-17-talk';
const tag = process.env.TAG ? `_${process.env.TAG}` : '';
mkdirSync(dir, { recursive: true });

for (const model of models) {
  const env = envFor(model);
  const md: string[] = [`# ${model} 대화 전문`, ''];
  const tot = { in: 0, read: 0, write: 0, out: 0, ms: [] as number[] };
  const add = (u?: { input: number; cacheRead: number; cacheWrite: number; output: number }, ms?: number) => {
    if (u) { tot.in += u.input; tot.read += u.cacheRead; tot.write += u.cacheWrite; tot.out += u.output; }
    if (ms) tot.ms.push(ms);
  };
  let n = 0;
  for (const s of SUSPECTS) {
    const owned = new Set<string>(INITIAL_OWNED);
    const history: ChatMsg[] = [];
    md.push(`## ${PERSONS[s.person].name}`, '');
    for (const t of s.turns) {
      for (const id of t.add ?? []) owned.add(id);
      const user = buildTalkPrompt({ person: s.person, text: t.text, owned, history, attached: t.attached });
      md.push(`**형사:** ${t.text}${t.attached ? `  \`[제시: ${t.attached.join(', ')}]\`` : ''}`, '');
      try {
        const out = await call({ task: 'talk', user }, env);
        const raw = JSON.parse(out.text) as { record?: string[] };
        const r = sanitizeTalk(raw, s.person, owned, t.text);
        const dropped = (raw.record ?? []).filter((id) => !r.record.includes(id));
        add(out.usage, out.ms);
        md.push(`**${PERSONS[s.person].name}:** ${r.reply.replace(/\n/g, '  \n')}`, '');
        const tags = [r.record.length && `기록 ${r.record.join(',')}`, r.give.length && `건넴 ${r.give.join(',')}`, r.admit.length && `인정 ${r.admit.join(',')}`, dropped.length && `걸러진 기록 ${dropped.join(',')}`].filter(Boolean);
        md.push(`> ${(out.ms / 1000).toFixed(1)}초 · 출력 ${out.usage?.output}토큰${tags.length ? ' · ' + tags.join(' · ') : ''}`, '');
        const reveals = [...r.record, ...r.give, ...r.admit];
        if ((r.record.length || r.admit.length)) reveals.push(STATEMENT_FORMS[s.person].statementId);
        for (const id of reveals) owned.add(id);
        history.push({ id: `h${n++}`, role: 'me', text: t.text, ...(t.attached ? { attached: t.attached } : {}) }, { id: `h${n++}`, role: 'them', text: r.reply });
      } catch (e) {
        md.push(`> 실패: ${String(e)}`, '');
      }
      console.log(model, s.person, t.text.slice(0, 20));
    }
  }
  md.push('## 수사팀', '');
  const history: ChatMsg[] = [];
  for (const text of DESK) {
    md.push(`**수사관:** ${text}`, '');
    try {
      const out = await call({ task: 'desk', user: buildDeskPrompt({ text, owned: new Set(INITIAL_OWNED), history, jobs: [] }) }, env);
      const r = sanitizeDesk(JSON.parse(out.text));
      add(out.usage, out.ms);
      md.push(`**수사팀:** ${r.reply.replace(/\n/g, '  \n')}`, '');
      const tags = [r.start.length && `조사 시작 ${r.start.join(',')}`, r.deflect.length && `거절 ${r.deflect.join(',')}`].filter(Boolean);
      md.push(`> ${(out.ms / 1000).toFixed(1)}초${tags.length ? ' · ' + tags.join(' · ') : ''}`, '');
      history.push({ id: `d${n++}`, role: 'me', text }, { id: `d${n++}`, role: 'them', text: r.reply });
    } catch (e) {
      md.push(`> 실패: ${String(e)}`, '');
    }
    console.log(model, 'desk', text.slice(0, 20));
  }
  const p = PRICE[model];
  const usd = p ? (tot.in * p.in + tot.read * p.read + tot.write * p.write + tot.out * p.out) / 1e6 : NaN;
  const ms = [...tot.ms].sort((a, b) => a - b);
  const summary = `호출 ${ms.length}회 · 응답 중앙값 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}초 · 최대 ${(ms[ms.length - 1] / 1000).toFixed(1)}초 · 입력 ${tot.in}+캐시읽기 ${tot.read}+캐시쓰기 ${tot.write} · 출력 ${tot.out} · 비용 약 $${usd.toFixed(4)}`;
  md.splice(1, 0, '', summary);
  writeFileSync(`${dir}/${model}${tag}.md`, md.join('\n'));
  console.log(model, summary);
}
