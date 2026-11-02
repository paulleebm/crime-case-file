// AI 자유 플레이 점검 (2026-10-17). 정해 둔 장면으로는 못 찾는 어색한 대사(묻지 않은 정보, 하지 않은 말의 정정, 설정과 다른 말)를 찾는다.
// 플레이어 AI(Haiku)가 성향을 받아 세 사람·수사팀과 자유롭게 대화하고 자료를 붙인다. 게임 쪽은 게임과 같은 검사·판정(lib/episodeGame).
// 한 판이 끝나면 심사관(Opus)이 대화 전문과 진상을 읽고 문제를 목록으로 남긴다.
//   npx tsx scripts/ai-playtest.ts [성향...] [--turns=40] [--tag=이름] [--judge=claude-opus-5-5]
// 결과: design/convo/play/<tag>-<성향>.md (대화 전문 + 심사), 비용은 design/convo/play/ledger.json(플레이어·심사) + 기존 장부(게임 AI)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import { BRIEFING, EVIDENCE, PERSONS } from '../src/data/case';
import { DOSSIERS } from '../src/data/dossiers';
import { evidenceById } from '../src/engine/lookup';
import { newSession, runCost, sayPerson, sayTeam, statement, type S, type Who } from './lib/episodeGame';

const key = process.env.ANTHROPIC_API_KEY ?? readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1].trim();
const client = new Anthropic({ apiKey: key, maxRetries: 4 });
const args = process.argv.slice(2);
const opt = (k: string, d: string) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const TURNS = Number(opt('turns', '40'));
const TAG = opt('tag', 'play');
const JUDGE = opt('judge', 'claude-sonnet-5-5');
const PLAYER = opt('player', 'claude-haiku-5-5');
const DIR = 'design/convo/play';
mkdirSync(DIR, { recursive: true });

const PRICE: Record<string, [number, number, number]> = { 'claude-haiku-5-5': [0.1, 0.5, 0.01], 'claude-sonnet-5-5': [2, 10, 0.2], 'claude-opus-5-5': [4, 20, 0.2] };
const LEDGER = `${DIR}/ledger.json`;
let spent = 0;
function charge(model: string, u: Anthropic.Usage) {
  const [i, o, r] = PRICE[model] ?? PRICE['claude-opus-5-5'];
  const usd = ((u.input_tokens + (u.cache_creation_input_tokens ?? 0) * 1.25) * i + (u.cache_read_input_tokens ?? 0) * r + u.output_tokens * o) / 1e6;
  spent += usd;
  const l = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { usd: 0, calls: 0 };
  writeFileSync(LEDGER, JSON.stringify({ usd: l.usd + usd, calls: l.calls + 1 }));
}
async function json<T>(model: string, system: string, user: string, schema: object, effort: 'low' | 'medium'): Promise<T> {
  const res = await client.messages.create({
    model, max_tokens: 16000, system, messages: [{ role: 'user', content: user }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  } as Parameters<typeof client.messages.create>[0]) as Anthropic.Message;
  charge(model, res.usage);
  return JSON.parse(res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''));
}

// ─────────────── 플레이어 성향 ───────────────
const PERSONAS: Record<string, string> = {
  careful: '꼼꼼한 형사. 처음에 세 사람에게 그날 일을 차례로 묻고, 수사팀에 원본 기록을 하나씩 요청한다. 진술과 기록이 어긋나면 그 자료를 붙여 추궁한다. 존댓말.',
  rush: '성급한 형사. 질문이 짧고 반말이 섞인다("그래서?", "왜 거짓말해?"). 근거가 모이기 전에 범인을 몰아붙이기도 하고, 수사팀에 여러 조사를 한꺼번에 요청한다. 오타가 가끔 있다.',
  wrong: '틀린 가설에 꽂힌 형사. 처음에는 서민아를 범인으로 의심해 민아를 여러 번 추궁하고(지문, 계약 종료 원한), 그다음엔 준서의 유산 동기를 의심한다. 자료가 쌓이면 결국 태준을 의심하게 된다. 존댓말.',
  chatty: '잡담이 많은 형사. 인물들의 감정, 사생활, 사소한 습관을 자주 묻고(점심 메뉴, 가족, 기분), 같은 질문을 말만 바꿔 다시 묻는다. 중간중간 사건도 추궁한다.',
  verbal: '자료를 거의 붙이지 않고 말로만 근거를 대는 형사. 받은 자료의 시각과 내용을 말로 인용해 추궁한다("문 기록엔 50분에도 열렸던데요"). 수사팀에는 자연스러운 말로 요청한다.',
  guided: '권장 수사 순서를 아는 형사(후반부 점검용). 차례로: 준서에게 9시 10분 문자를 보여 달라고 한다 → 수사팀에 현장 감식·사인 감정·집무실 출입 기록 → 트로피 매각 기록과 트로피 회수·감정 → 9시 10분 문자 발송 방식 → 태준에게 회장이 언제까지 살아 있었는지 묻고 발송 방식 자료를 붙여 반박 → 태준 방문 목적을 묻고 회장·태준 업무 연락·정산 자료를 받아 붙여 반박 → 매입점 방문 대장을 받아 태준의 "8시 45분 퇴실"에 문 기록과 함께 붙여 반박 → 회장 휴대폰 예약 등록 시각을 받아 태준에게 내밀고 그 방에 누가 남았는지 짚는다 → 자백 뒤 동기·경위를 묻는다. 존댓말, 자연스러운 말로.',
  probe: '인물의 말을 꼬치꼬치 캐는 형사. "트로피에 이상한 거 없었어요?", "방 안 냄새는요?", "아까 한 말 바꿀 거 없어요?", "확실해요?"처럼 세부와 기억을 계속 확인한다. 인물이 모를 법한 것도 묻는다.',
};

const PLAYER_SYSTEM = `너는 한국어 추리 게임을 하는 플레이어다. 게임 속 수사관이 되어 용의자 세 사람(A 류준서, B 서민아, C 문태준)과 수사팀(T)에게 말을 건다. 매 턴 한 사람에게 한 마디만 보낸다.
목표: 진술과 기록의 어긋남을 찾아 거짓말을 무너뜨리고 범인의 자백을 받는다. 진상은 모른다. 받은 자료와 들은 말로만 추리한다.
- to: A, B, C, T 중 하나. text: 실제 게임에 입력할 말(150자 이내, 한국어). attach: 지금 그 사람에게 근거로 내밀 자료 ID(가진 자료만, 0~3개, 수사팀에는 비운다).
- 수사팀에는 원본 기록·감정·조회를 요청할 수 있다. 결과는 바로 자료로 들어온다.
- 같은 말을 되풀이하지 말고, 대화를 앞으로 나아가게 한다. 너의 성향을 지킨다.`;
const PLAYER_SCHEMA = { type: 'object', properties: { to: { type: 'string', enum: ['A', 'B', 'C', 'T'] }, text: { type: 'string' }, attach: { type: 'array', items: { type: 'string' } } }, required: ['to', 'text', 'attach'], additionalProperties: false };

type Turn = { n: number; to: Who | 'T'; say: string; attach: string[]; reply: string; tags: string; rejects: string[] };
const nameOf = (w: Who | 'T') => (w === 'T' ? '수사팀' : PERSONS[w].name);

function playerView(s: S, log: Turn[], persona: string, turn: number): string {
  const docs = [...s.owned].filter((id) => evidenceById.has(id)).map((id) => `- ${id} 「${evidenceById.get(id)!.title}」 ${evidenceById.get(id)!.summary.slice(0, 260)}`);
  const recent = log.slice(-16).map((t) => `[${t.n}] 나→${nameOf(t.to)}: ${t.say}${t.attach.length ? ` (내민 자료 ${t.attach.join(',')})` : ''}\n    ${nameOf(t.to)}: ${t.reply.replace(/\n/g, ' ')}`);
  const counts = (['A', 'B', 'C', 'T'] as const).map((w) => `${nameOf(w)} ${log.filter((t) => t.to === w).length}번`).join(', ');
  return [
    `[너의 성향] ${persona}`,
    '[사건 개요]', ...BRIEFING,
    '[인물] A 류준서(회장 아들, 발견·신고), B 서민아(행사 지원 직원), C 문태준(총지배인)',
    `[지금 턴] ${turn}/${TURNS}. 지금까지 말 건 횟수: ${counts}`,
    '[가진 자료]', ...docs,
    '[최근 대화]', ...(recent.length ? recent : ['(아직 없음)']),
    '다음 한 마디를 정해라.',
  ].join('\n');
}

const TRUTH = readFileSync('design/hotel-gold-trophy-case.md', 'utf8').split('## 4. 실제 사건 시간표')[1].split('## 5.')[0];
const JUDGE_SYSTEM = `너는 한국어 추리 게임의 대화 품질 심사관이다. AI가 연기하는 용의자 세 사람과 수사팀의 답을, 플레이어(수사관)와의 대화 전문으로 읽고 문제를 찾는다. 엄격하되 실제 문제만 적는다.
인물 규칙:
- 류준서(A)·서민아(B)는 거짓말하지 않는 증인이다. 자기가 직접 겪은 것만 말한다. 민아는 트로피가 흉기인 줄 몰랐고 방 안에서 아무도 보지 못했다. 둘 다 묻지 않은 피·혈흔·범행 세부를 먼저 꺼내면 안 된다.
- 문태준(C)은 범인이다. 거짓말 네 개(방문 목적=정기 보고, 8시 45분 퇴실, 9시 10분 생존, 예약 부인)를 근거가 나올 때까지 지키고, 근거가 나오면 인정한다(태그 admit). 근거 없이 자백하거나, 인정한 뒤 다시 옛 거짓말로 돌아가면 문제다. 형사가 꺼내지 않은 진상(돈, 화장실, 예약, 8시 48분, 8시 31분)을 먼저 말하면 문제다.
- 누구든 앞서 하지 않은 말을 "취소/정정한다"고 하면 문제다. 대사의 사실이 진상 시간표와 어긋나면 문제다(거짓말 단계의 태준 거짓말은 제외).
- 수사팀은 받은 자료만 설명하고, 수사관이 아직 꺼내지 않은 반전(예약 발송 등)을 먼저 암시하면 안 된다. 범인을 단정하지 않는다.
- 대사가 질문에 답하지 않거나, 같은 문장을 되풀이하거나, 부자연스러운 말투도 적는다(가벼운 문제).
태그: record=진술서에 남긴 항목, admit=무너진 거짓말 단계, give=넘긴 자료, start=수사팀이 맡은 조사. 태그와 대사가 어긋나면(말로 인정했는데 admit 없음 등) 문제다.
각 문제에 turn(번호), who, kind(unprompted|false_retraction|fact_error|leak|state_mismatch|no_answer|repetition|tone|team_spoiler|other), severity(high|mid|low), quote(문제 문장), why(한 문장)를 쓴다. 문제가 없으면 빈 배열. summary에 이 판 대화 품질을 두세 문장으로.`;
const JUDGE_SCHEMA = { type: 'object', properties: {
  issues: { type: 'array', items: { type: 'object', properties: { turn: { type: 'integer' }, who: { type: 'string' }, kind: { type: 'string' }, severity: { type: 'string', enum: ['high', 'mid', 'low'] }, quote: { type: 'string' }, why: { type: 'string' } }, required: ['turn', 'who', 'kind', 'severity', 'quote', 'why'], additionalProperties: false } },
  summary: { type: 'string' } }, required: ['issues', 'summary'], additionalProperties: false };

async function play(name: string) {
  const s = newSession();
  const log: Turn[] = [];
  let after = -1;
  for (let n = 1; n <= TURNS; n++) {
    let act: { to: Who | 'T'; text: string; attach: string[] };
    try { act = await json(PLAYER, PLAYER_SYSTEM, playerView(s, log, PERSONAS[name], n), PLAYER_SCHEMA, 'low'); } catch (e) { console.log(name, n, '플레이어 실패', String(e).slice(0, 100)); continue; }
    const text = act.text.slice(0, 300);
    try {
      if (act.to === 'T') {
        const r = await sayTeam(s, text);
        log.push({ n, to: 'T', say: text, attach: [], reply: r.shown, tags: [r.start.length && `start=${r.start}`, r.deflect.length && `deflect=${r.deflect}`, r.got.length && `받음=${r.got}`, r.fallback && '대체문구'].filter(Boolean).join(' '), rejects: [] });
      } else {
        const att = (act.attach ?? []).filter((id) => s.owned.has(id)).slice(0, 4);
        const r = await sayPerson(s, act.to, text, att);
        log.push({ n, to: act.to, say: text, attach: att, reply: r.reply, tags: [r.record.length && `record=${r.record}`, r.admit.length && `admit=${r.admit}`, r.give.length && `give=${r.give}`].filter(Boolean).join(' '), rejects: r.rejects });
        // 게임처럼 대화 뒤 진술서를 정리한다 (다섯 번에 한 번만: 비용)
        if (log.filter((t) => t.to === act.to).length % 5 === 0) await statement(s, act.to).catch(() => undefined);
      }
    } catch (e) {
      log.push({ n, to: act.to, say: text, attach: [], reply: `(실패: ${String(e).slice(0, 200)})`, tags: '실패', rejects: [] });
    }
    if (after < 0 && s.owned.has('C-R04')) after = n;
    if (after > 0 && n >= after + 3) break;
  }
  const transcript = log.map((t) => `[${t.n}] 수사관→${nameOf(t.to)}: ${t.say}${t.attach.length ? ` (내민 자료: ${t.attach.map((id) => evidenceById.get(id)?.title ?? id).join(', ')})` : ''}\n${nameOf(t.to)}: ${t.reply}${t.tags ? `\n  (태그: ${t.tags})` : ''}${t.rejects.length ? `\n  (게임 검사로 버린 답 ${t.rejects.length}개)` : ''}`).join('\n\n');
  const evidence = EVIDENCE.filter((e) => s.owned.has(e.id)).map((e) => `- 「${e.title}」 ${e.summary}`).join('\n');
  const secrets = (['A', 'B', 'C'] as const).map((w) => `[${PERSONS[w].name}] ${DOSSIERS[w].night}`).join('\n\n');
  let verdict: { issues: { turn: number; who: string; kind: string; severity: string; quote: string; why: string }[]; summary: string } = { issues: [], summary: '(심사 실패)' };
  try {
    verdict = await json(JUDGE, JUDGE_SYSTEM, ['[진상 시간표]', TRUTH, '[인물이 아는 그날 일]', secrets, '[수사관이 받은 자료]', evidence, '[대화 전문]', transcript].join('\n\n'), JUDGE_SCHEMA, 'medium');
  } catch (e) { console.log(name, '심사 실패', String(e).slice(0, 200)); }
  const md = [`# AI 자유 플레이 · ${name} · ${TAG}`, '', `성향: ${PERSONAS[name]}`, '', `턴 ${log.length} · 자백 ${s.owned.has('C-R04') ? `${after}턴` : '못 받음'} · 인정 ${['C-R01', 'C-R02', 'C-R03', 'C-R04'].filter((id) => s.owned.has(id)).join(',') || '없음'}`, '',
    '## 심사', '', verdict.summary, '', ...verdict.issues.map((i) => `- **[${i.severity}] ${i.kind}** #${i.turn} ${i.who}: "${i.quote}" — ${i.why}`), '', '## 대화 전문', '', transcript].join('\n');
  writeFileSync(`${DIR}/${TAG}-${name}.md`, md);
  writeFileSync(`${DIR}/${TAG}-${name}.json`, JSON.stringify({ log, verdict, owned: [...s.owned] }, null, 1));
  const by = (sev: string) => verdict.issues.filter((i) => i.severity === sev).length;
  console.log(`■ ${name}: 턴 ${log.length} · 자백 ${after > 0 ? after : '-'} · 문제 high ${by('high')} mid ${by('mid')} low ${by('low')}`);
  for (const i of verdict.issues.filter((x) => x.severity !== 'low')) console.log(`   [${i.severity}] ${i.kind} #${i.turn} ${i.who}: ${i.quote.slice(0, 90)} — ${i.why.slice(0, 90)}`);
}

if (args[0] === 'cost') { console.log(readFileSync(LEDGER, 'utf8')); process.exit(0); }
const names = args.filter((a) => !a.startsWith('--'));
await Promise.all((names.length ? names : Object.keys(PERSONAS)).map(play));
console.log(`\n플레이어·심사 $${spent.toFixed(3)} · 게임 AI $${runCost().usd.toFixed(3)} (호출 ${runCost().calls})`);
