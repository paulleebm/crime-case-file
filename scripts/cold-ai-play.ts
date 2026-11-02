// 「두 번 죽은 남자」(/cold)를 AI 플레이어로 끝까지 돌린다. 게임 쪽은 실제와 같다:
// 수사 지시는 coldOrder, 조사실은 coldTalk(둘 다 Haiku)로 해석하고 엔진이 판정한다. 플레이어만 AI다.
// 실행: npx tsx scripts/cold-ai-play.ts <이름> [플레이어 모델] [성향] [최대 턴]
//   예: npx tsx scripts/cold-ai-play.ts haiku-a claude-haiku-5-5 careful 120
// 기록: design/playtest-2026-10-23-cold/<이름>.json, .md
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runAi } from '../server/aiHandler';
import { PRICE } from '../src/ai/pricing';
import {
  accuse, clockText, endDay, evidenceById, hoursLeftToday, leave, newGame, personById, questionStates, raining,
  runOrder, visiblePersons, type ColdState,
} from '../src/cold/engine';
import { buildOrderPrompt, sanitizeOrder } from '../src/cold/orderParse';
import { buildTalkPrompt, sanitizeTalk, talkTurn } from '../src/cold/talkParse';
import { BRIEFING, INTRO } from '../src/cold/twiceDead';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const [name = 'run', playerModel = 'claude-haiku-5-5', style = 'careful', maxTurnsArg = '120'] = process.argv.slice(2);
const MAX_TURNS = Number(maxTurnsArg);
const gameEnv = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: 'claude-haiku-5-5' };
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY!, maxRetries: 2, timeout: 90000 });

const STYLES: Record<string, string> = {
  careful: '꼼꼼한 플레이어다. 자료를 잘 읽고, 이상한 점을 하나씩 확인한다. 의문 수첩을 최대한 다 풀고 싶어 한다.',
  hasty: '성급한 플레이어다. 의심 가는 사람을 빨리 정하고 몰아붙인다. 자료는 대충 읽는다. 두 시간 넘게 붙잡고 있지 않는다.',
};

const SYSTEM = `너는 한국어 수사 게임을 처음 하는 플레이어다. ${STYLES[style] ?? STYLES.careful}
게임: 2006년 12월 강원도 소진항. 3년 전 사망 처리된 남자가 펜션 별채에서 숨진 채 발견됐다. 너는 강력팀 형사다.
너는 정답을 모른다. 화면에 보이는 것만으로 추리한다.

할 수 있는 것 (action):
- order: 동료 반장에게 수사를 지시한다. text에 평소 말하듯 쓴다(조사, 감정, 기록 조회, 탐문, 사람 부르기, 영장, "지금까지 정리해 줘"). 사람을 부르면 조사실이 열린다. 피의자로 부르려면 "피의자로"라고 말한다. 미성년자 조사 때 할머니를 빼려면 "혼자"라고 말한다.
- talk: 조사실에 있을 때 그 사람에게 말한다. 질문하거나, 가진 자료의 내용을 들이밀며 따진다.
- leave: 조사를 마친다.
- end_day: 하루를 마친다(결과를 기다리거나 오늘 시간이 모자랄 때).
- accuse: 수사를 끝내고 송치한다. accused에 이름, charge에 "살인" 또는 "폭행치사". 되돌릴 수 없다.

규칙:
- 한 번에 하나만 한다. text는 한두 문장, 진짜 플레이어처럼 짧게 쓴다.
- memo는 네 수사 수첩이다. 중요한 사실, 의심, 다음에 할 일을 적어 둔다(매번 전체를 다시 쓴다, 1200자 이내). 지난 메모는 다시 보여 준다.
- 같은 말을 되풀이하지 않는다. 막히면 다른 방향을 시도한다.
- 지정된 JSON으로만 답한다.`;

const SCHEMA = {
  type: 'object',
  properties: {
    memo: { type: 'string' },
    action: { type: 'string', enum: ['order', 'talk', 'leave', 'end_day', 'accuse'] },
    text: { type: 'string' },
    accused: { type: 'string' },
    charge: { type: 'string' },
  },
  required: ['memo', 'action', 'text', 'accused', 'charge'],
  additionalProperties: false,
};

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
const cost = { player: 0, game: 0 };
const usd = (model: string, u: Usage) => { const p = PRICE[model]; return p ? (u.input * p.in + u.cacheRead * p.read + u.cacheWrite * p.write + u.output * p.out) / 1e6 : 0; };

function screen(s: ColdState, seenDocs: Set<string>, memo: string, lastNote: string): string {
  const fresh = s.have.filter((id) => evidenceById.has(id) && id !== 'E20s' && !seenDocs.has(id));
  fresh.forEach((id) => seenDocs.add(id));
  const qs = questionStates(s).map((q) => `${q.id} ${q.title} — ${q.state === '증거' ? `해결: ${q.answer}` : q.state === '진술' ? `진술로 확인: ${q.answer}` : '미해결'}`);
  const people = visiblePersons(s).map((p) => `${p.name}(${p.role}${p.deep ? ', 소환 4시간' : ', 방문 1시간'})`).join(', ');
  const conv = s.session ? s.session.log.slice(-8) : s.orders.slice(-6);
  return [
    `[지금] ${clockText(s.clock)} · ${raining(s) ? '비' : '맑음, 12-13(수) 14시부터 비 예보'} · 오늘 남은 근무 ${Math.max(0, hoursLeftToday(s))}시간 · 수사 기한 2007-01-10`,
    `[있는 곳] ${s.session ? `조사실 — ${personById.get(s.session.person)!.name}${s.session.suspect ? ' (피의자)' : ''}${s.session.withGrandma ? ' (할머니 동석)' : ''}` : '사무실 (반장과 대화 중)'}`,
    `[의문 수첩]\n${qs.join('\n')}`,
    `[관계자] ${people}`,
    `[기다리는 결과] ${[...new Set(s.pending.map((p) => evidenceById.get(p.id)?.title ?? p.id))].join(', ') || '없음'}`,
    `[가진 자료] ${s.have.filter((id) => evidenceById.has(id) && id !== 'E20s').map((id) => evidenceById.get(id)!.title).join(', ')}`,
    ...(fresh.length ? ['[새로 받은 자료 — 전문]', ...fresh.map((id) => `■ ${evidenceById.get(id)!.title}\n${evidenceById.get(id)!.body}`)] : []),
    ...(lastNote ? [`[알림] ${lastNote}`] : []),
    `[최근 대화]\n${conv.map((l) => `${l.who}: ${l.text}`).join('\n')}`,
    `[내 수첩]\n${memo || '(비어 있음)'}`,
    '다음에 무엇을 할까?',
  ].join('\n\n');
}

async function playerTurn(prompt: string) {
  const res = await client.messages.create({
    model: playerModel,
    max_tokens: 3000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
  } as Anthropic.MessageCreateParamsNonStreaming);
  const u = res.usage;
  cost.player += usd(playerModel, { input: u.input_tokens, output: u.output_tokens, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 });
  const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return JSON.parse(text) as { memo: string; action: string; text: string; accused: string; charge: string };
}

async function game(task: 'coldOrder' | 'coldTalk', user: string) {
  const out = await runAi({ task, user }, gameEnv) as { text: string; usage?: Usage };
  if (out.usage) cost.game += usd('claude-haiku-5-5', out.usage);
  return JSON.parse(out.text);
}

type Row = { turn: number; clock: string; where: string; action: string; text: string; reply: string; got: string[]; interp?: string };
const rows: Row[] = [];
let s = newGame();
const seen = new Set<string>();
let memo = '';
let note = `시작 컷신:\n${INTRO.map((x) => x.lines).join('\n')}\n\n반장 브리핑:\n${BRIEFING}`;
let accusedName = '';

for (let turn = 1; turn <= MAX_TURNS && !s.ending; turn++) {
  const before = s;
  const where = s.session ? personById.get(s.session.person)!.name : '반장';
  let p;
  try { p = await playerTurn(screen(s, seen, memo, note)); } catch (e) { console.error('플레이어 실패', e); break; }
  memo = p.memo.slice(0, 1500);
  note = '';
  let interp = '';
  if (p.action === 'end_day') {
    s = endDay(s);
    note = s.morning ? `아침 보고:\n${s.morning.join('\n')}` : '';
    s = { ...s, morning: null };
  } else if (p.action === 'leave') {
    s = leave(s);
  } else if (p.action === 'accuse') {
    const id = [...personById.values()].find((x) => p.accused.includes(x.name))?.id;
    if (!id) { note = `송치할 사람을 찾지 못했다: ${p.accused}`; } else {
      accusedName = personById.get(id)!.name;
      s = accuse(s, id, p.charge.includes('폭행') ? '폭행치사' : '살인');
    }
  } else if (p.action === 'talk' && s.session) {
    const t = sanitizeTalk(await game('coldTalk', buildTalkPrompt(p.text, s)), s);
    interp = `${t.kind} ${t.topic} ${t.evidence.join(',')}`;
    s = talkTurn(s, p.text, t);
  } else {
    if (s.session) s = leave(s);
    const o = sanitizeOrder(await game('coldOrder', buildOrderPrompt(p.text, s, s.orders)));
    interp = `${o.kind} ${o.ids.join(',')}`;
    s = runOrder(s, p.text, o, { suspect: /피의자/.test(p.text), withGrandma: !/(혼자|따로|할머니 없이|할머니 빼고|단독)/.test(p.text) });
  }
  // 조사실 말이면 조사실 대화에 새로 붙은 줄, 지시면 반장의 답 + 새로 열린 조사실의 첫마디
  const log = p.action === 'talk'
    ? (s.session?.log ?? []).slice(before.session?.log.length ?? 0)
    : [...s.orders.slice(before.orders.length), ...(s.session && s.session !== before.session && p.action === 'order' ? s.session.log : [])];
  const reply = log.filter((l) => l.who !== '나').map((l) => `${l.who}: ${l.text}`).join('\n');
  const got = s.have.filter((id) => !before.have.includes(id));
  rows.push({ turn, clock: clockText(before.clock), where, action: p.action, text: p.text, reply, got, ...(interp ? { interp } : {}) });
  console.log(`#${turn} ${clockText(before.clock)} [${where}] ${p.action}: ${p.text}${interp ? `  ⟨${interp}⟩` : ''}\n   → ${reply.replace(/\n/g, ' ⏎ ').slice(0, 220)}${got.length ? `\n   + ${got.join(',')}` : ''}`);
}

const end = s.ending;
const summary = {
  name, playerModel, style, turns: rows.length, ending: end?.key ?? '(끝나지 않음)', accused: accusedName, charge: end?.charge ?? '',
  days: end?.days ?? null, finalClock: clockText(s.clock),
  questions: questionStates(s).map((q) => `${q.id}:${q.state}`), side: end?.side ?? [],
  costUsd: { player: +cost.player.toFixed(4), game: +cost.game.toFixed(4) }, memo,
};
console.log('\n', JSON.stringify(summary, null, 1));
const dir = 'design/playtest-2026-10-23-cold';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/${name}.json`, JSON.stringify({ summary, rows }, null, 1));
writeFileSync(`${dir}/${name}.md`, [
  `# AI 플레이 기록 — ${name}`, '',
  `- 플레이어 ${playerModel} (${style}), 게임 해석 claude-haiku-5-5`,
  `- 결말 ${summary.ending}${accusedName ? ` (송치 ${accusedName}, ${summary.charge})` : ''}, ${rows.length}턴, 마지막 시각 ${summary.finalClock}`,
  `- 의문 수첩 ${summary.questions.join(' ')}`,
  `- 비용 플레이어 $${summary.costUsd.player} · 게임 $${summary.costUsd.game}`, '',
  '| 턴 | 시각 | 어디 | 행동 | 플레이어 | 해석 | 답 | 새 자료 |', '|---|---|---|---|---|---|---|---|',
  ...rows.map((r) => `| ${r.turn} | ${r.clock} | ${r.where} | ${r.action} | ${r.text.replace(/\|/g, '/')} | ${r.interp ?? ''} | ${r.reply.replace(/\n/g, ' ⏎ ').replace(/\|/g, '/').slice(0, 300)} | ${r.got.join(', ')} |`),
  '', '## 마지막 수첩', '', memo,
].join('\n'));
