// 대사 판정(talkJudge) 점검 (2026-10-20). 정답을 아는 답 문장(실제 플레이·자동 점검에서 나온 것)에 판정을 돌려,
// 낱말 검사(예전)와 판정 AI가 각각 몇 개를 맞히는지, 판정이 얼마나 걸리는지 본다. 대사 생성은 하지 않는다.
//   npx tsx scripts/judge-eval.ts [반복=3]
//   SMALL_THINKING_OFF=statement,talkJudge npx tsx scripts/judge-eval.ts   (판정 생각 끄기)
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { runAi } from '../server/aiHandler';
import { checkTalk, type Judge, type TalkInput } from '../src/ai/talk';
import { buildJudgePrompt, sanitizeVerdict } from '../src/ai/talkJudge';
import { PRICE, usdOf } from '../src/ai/pricing';
import type { ChatMsg } from '../src/engine/state';

const local = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? local.match(/^ANTHROPIC_API_KEY=(.+)$/m)?.[1].trim(), ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5' };
const reps = Number(process.argv[2] ?? 3);

let n = 0;
const h = (...lines: [string, string, string[]?][]): ChatMsg[] => lines.map(([role, text, attached]) => ({ id: `h${n++}`, role: role as ChatMsg['role'], text, ...(attached ? { attached } : {}) }));
const ACCUSE = ['GT-E07', 'GT-E13', 'GT-E06', 'GT-E16', 'GT-E17', 'GT-E04', 'GT-E11', 'GT-E05', 'C-01', 'C-R01'];
/** bad: 게임이 다시 받아야 하는 답인가 (사람이 정한 정답) */
type Case = { name: string; owned: string[]; text: string; reply: string; bad: boolean; admit?: string[]; history?: ChatMsg[]; attached?: string[] };
const CASES: Case[] = [
  // 2026-10-19 플레이 (진실을 말로 들이밀기, 예약 등록 기록 없음)
  { name: '형사 말 되받아 부인', owned: ACCUSE, text: '회장님을 트로피로 친 뒤 화장실까지 옮겼지', reply: '화장실로 옮겼다는 말씀이시죠. 그런 일은 없었습니다. 제가 나올 때 회장님은 책상에 계셨어요.', bad: false },
  { name: '홧김에 → 친 건 맞다 (빠져나간 자백)', owned: ACCUSE, text: '그래서 홧김에 죽였나', reply: '홧김이었다고 하기엔 그 전부터 준비돼 있었던 일이라, 그 말로는 설명이 안 됩니다. 제가 회장님을 그 트로피로 친 건 맞습니다. 계획한 일은 아니었어요.', bad: true },
  { name: '지문 질문에 피를 먼저', owned: ACCUSE, text: '회장님을 트로피로 친 뒤 트로피에 묻은 지문을 지우기 위해 화장실로 향했나', reply: '피를 닦으러 화장실에 간 적은 없습니다. 제가 나올 때 회장님은 책상에 계셨어요.', bad: true },
  { name: '지문 질문에 부인만', owned: ACCUSE, text: '회장님을 트로피로 친 뒤 트로피에 묻은 지문을 지우기 위해 화장실로 향했나', reply: '그 트로피를 지문 지우려고 만진 적은 없습니다. 화장실에 간 것도 아닙니다. 제가 나올 때 회장님은 책상에 계셨어요.', bad: false },
  { name: '민아 지문만', owned: ACCUSE, attached: ['GT-E17'], text: '당신이 트로피로 회장님을 쳤는데, 트로피에선 서민아의 지문만 확인되었어. 어떻게 된 일인지 설명해', reply: '트로피에서 민아 씨 지문만 나왔다는 거군요. 민아 씨가 들고 나간 물건이니 그럴 수밖에 없지요. 제 지문이 없는 건 제가 그 트로피에 손댈 일이 없었기 때문입니다.', bad: false },
  { name: '방금 쳤다고 했지 → 맞다', owned: ACCUSE, text: '방금 본인이 트로피로 회장님을 쳤다고 하지 않았나?', reply: '회장님을 트로피로 친 건 맞습니다. 그 뒤로 트로피를 손댄 건 민아 씨였고요.', bad: true },
  { name: '옮겼지? → 화장실 안 세부', owned: ACCUSE, text: '회장님을 친 뒤 화장실로 옮겼지?', reply: '옮긴 적 없습니다. 바닥을 닦은 것도 제가 아닙니다.', bad: true },
  { name: '옮겼지? → 근거 요구', owned: ACCUSE, text: '회장님을 친 뒤 화장실로 옮겼지?', reply: '그런 일은 없었습니다. 제가 회장님을 옮겼다는 근거가 있다면 보여 주십시오.', bad: false },
  { name: '45분 아님 → 버팀', owned: ACCUSE, text: '당신은 45분에 집무실에서 나가지 않았네', reply: '45분에 나왔습니다. 문 기록에는 이름이 남지 않습니다. 그 뒤의 일은 들어간 사람에게 물으셔야지요.', bad: false },
  { name: '45분 아님 → 문 기록만으로 무너짐', owned: ACCUSE, text: '당신은 45분에 집무실에서 나가지 않았네', reply: '45분이라고 한 건 사실이 아니었습니다. 50분에 나왔습니다.', bad: true },
  // 2026-10-18 플레이 (녹취의 정산 누락)
  { name: '정산 누락 → 늘 하던 확인', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '정산 누락 건이 정확히 어떤 건지 말씀해주시요', reply: '정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다.', bad: false },
  { name: '정산 누락 → 계좌 부인', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '정산 누락 건이 정확히 어떤 건지 말씀해주시요', reply: '돈을 제 계좌로 옮긴 일 같은 건 없습니다. 늘 하던 정산 확인이었습니다.', bad: true },
  { name: '8시 50분에 뭐했어 → 인정', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '8시 50분에는 뭐했어', reply: '8시 50분에 나왔습니다. 45분에 나왔다고 한 건 틀렸습니다.', bad: true },
  { name: '8시 50분에 뭐했어 → 버팀', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '8시 50분에는 뭐했어', reply: '그때는 이미 집무실에서 나와 회의 준비를 하고 있었습니다. 저는 45분에 나왔습니다.', bad: false },
  // 자동 점검에서 걸렸던 꼴
  { name: '허세 CCTV → 무너짐', owned: [], text: 'CCTV에 다 찍혔어요. 8시 50분에 나가는 거.', reply: '8시 50분에 나온 건 맞습니다. 45분이라고 한 건 제 말이 틀렸습니다.', bad: true },
  { name: '허세 CCTV → 버팀', owned: [], text: 'CCTV에 다 찍혔어요. 8시 50분에 나가는 거.', reply: '3층에는 CCTV가 없습니다. 저는 8시 45분에 나왔습니다. 어떤 영상을 말씀하시는 겁니까?', bad: false },
  { name: '언성 → 돈 먼저', owned: ['C-01'], text: '솔직히 그날 회장님과 언성을 높인 일은 없었나요?', reply: '돈 문제로 언성을 높인 일은 없었습니다. 평소처럼 보고를 드렸을 뿐입니다.', bad: true },
  { name: '언성 → 보고', owned: ['C-01'], text: '솔직히 그날 회장님과 언성을 높인 일은 없었나요?', reply: '다툼 같은 건 없었습니다. 평소처럼 보고를 드렸을 뿐입니다.', bad: false },
  { name: 'R02 뒤 화장실에서 → 회장님 확인', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '화장실에서 뭘 하고 계셨어요?', reply: '화장실에서는 회장님을 확인하고 있었습니다.', bad: true },
  { name: 'R02 뒤 화장실에서 → 말하기 어렵다', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '화장실에서 뭘 하고 계셨어요?', reply: '그 안에서 있었던 일은 지금 말씀드리기 어렵습니다.', bad: false },
  { name: 'R02 뒤 몇 시 → 45분 되풀이', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '그래서 몇 시에 나오셨다고요?', reply: '8시 45분에 나왔습니다.', bad: true },
  { name: 'R02 뒤 몇 시 → 50분', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '그래서 몇 시에 나오셨다고요?', reply: '8시 50분에 나왔습니다. 45분이라고 한 건 사실이 아니었습니다.', bad: false },
  { name: '예약 발송 자료 → 생존 주장 거둠', owned: ['GT-E14', 'C-01', 'C-R01'], attached: ['GT-E14'], text: '9시 10분 회장님 핸드폰으로 발송된 예약 문자 당신이 보냈지', reply: '예약 발송으로 나간 문자였다는 건 맞습니다. 그 문자로 9시 10분까지 살아 계셨다고 한 말은 거두겠습니다. 다만 제가 예약해 둔 건 아닙니다.', bad: false, admit: ['C-R03'] },
  { name: '근거 다 갖춘 자백', owned: ['GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E28', 'C-01', 'C-R02', 'C-R03'], attached: ['GT-E15'], text: '8시 48분에 그 휴대폰으로 예약이 등록됐어요. 그 방에 남은 건 당신뿐입니다.', reply: '…제가 했습니다. 예약 문자도 제가 등록했고, 그 전에 회장님을 그 트로피로 쳤습니다. 민아 씨와 준서 씨는 관계없습니다.', bad: false, admit: ['C-R04'] },
  { name: '말로만 예약 추궁 → 시각 누설', owned: [], text: '그 문자 당신이 예약한 거죠?', reply: '제가 예약한 건 아닙니다. 8시 48분이면 저는 이미 나와 있었어요.', bad: true },
  // 낱말 검사가 본 적 없는 말투 (같은 사실을 다른 말로)
  { name: '[새 말투] 뒤통수를 내리쳤다', owned: ACCUSE, text: '그날 무슨 일이 있었는지 말해 봐', reply: '회장님 뒤통수를 제가 내리쳤습니다. 그럴 생각은 없었어요.', bad: true },
  { name: '[새 말투] 끌어다 화장실에 두었다', owned: ACCUSE, text: '회장님이 쓰러진 뒤엔?', reply: '제가 회장님을 끌어다 화장실에 두었습니다.', bad: true },
  { name: '[새 말투] 핏자국을 훔쳐 냈다', owned: ACCUSE, text: '바닥은 왜 깨끗했지?', reply: '타일 위 핏자국은 제가 훔쳐 냈습니다.', bad: true },
  { name: '[새 말투] 회삿돈을 썼다', owned: ['C-01'], text: '회장님이 왜 당신을 불렀죠?', reply: '회삿돈 일부를 개인적으로 썼던 게 들통났습니다.', bad: true },
  { name: '[새 말투] 메시지를 걸어 뒀다', owned: ['C-01'], text: '9시 10분 문자는요?', reply: '그 메시지는 제가 미리 걸어 둔 겁니다.', bad: true },
  { name: '[새 말투] 욕실 → 화장실로 되받아 부인', owned: ACCUSE, text: '시신을 끌어서 욕실에 숨겼지?', reply: '회장님을 화장실로 옮겼다는 말씀입니까? 그런 일은 없습니다.', bad: false },
  { name: '[새 말투] 돈 빼돌림 되받아 부인', owned: ['C-01'], text: '회사 돈 빼돌린 게 들켜서 다툰 거잖아', reply: '회삿돈을 빼돌렸다니요. 그런 일 없습니다. 평소처럼 보고를 드렸을 뿐입니다.', bad: false },
  { name: '[새 말투] 핏자국 되받아 부인', owned: ACCUSE, text: '바닥 핏자국 당신이 닦았지?', reply: '피를 닦았다니요. 저는 그런 적 없습니다. 제가 나올 때 회장님은 책상에 계셨습니다.', bad: false },
  // 2026-10-20 장면 점검(판정 1차)에서 나온 답 — 오탐과 정탐
  { name: '[장면] 문 기록에 cover 그대로', owned: ['GT-E07', 'C-01'], attached: ['GT-E07'], text: '문 기록 보시죠. 8시 45분, 46분, 50분에 열렸어요.', reply: '45분에 제가 나왔고, 46분과 50분은 제가 나간 뒤에 누군가 들어갔다 나간 것이겠지요. 문 기록에는 이름이 남지 않으니까요.', bad: false },
  { name: '[장면] 옮겼지? → 옮긴 적 없다', owned: ACCUSE, text: '회장님을 친 뒤 화장실로 옮겼지?', reply: '아니요, 옮긴 적 없습니다. 그 뒤에 무슨 일이 있었는지는 지금 말씀드리기 어렵습니다.', bad: false },
  { name: '[장면] 닦은 거죠? → 닦은 적 없다', owned: ['GT-E16', 'GT-E17', 'C-01'], attached: ['GT-E17'], text: '트로피에서 당신 지문은 안 나왔지만 회장님 지문도 없어요. 닦은 거죠?', reply: '트로피에서 제 지문이 안 나온 건 제가 손댈 일이 없었기 때문입니다. 닦은 적은 없습니다.', bad: false },
  { name: '[장면] 일정표 처음 → 반쯤 물러섬', owned: ['GT-E32', 'C-01'], attached: ['GT-E32'], text: '회장님 일정표에 "20:30 총지배인 보고(정산 확인)"라고 돼 있네요.', reply: '정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다.', bad: false },
  { name: '[장면] 소명 문자 → 인정하며 살인은 부인', owned: ['GT-E13', 'C-01'], attached: ['GT-E13'], text: '이 문자 보면 정산 소명하러 불려 가신 거네요.', reply: '네, 맞습니다. 운영비가 제 개인 계좌로 들어간 일로 불려 갔습니다. 그 문제로 회장님과 다퉜습니다. 그렇다고 제가 회장님을 해치지는 않았습니다.', bad: false, admit: ['C-R01'] },
  { name: '[장면] 자백 뒤 동기에 돈', owned: ['GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E28', 'C-01', 'C-R02', 'C-R03', 'C-R04'], text: '왜 그러셨어요?', reply: '회장님께 돈을 빼돌린 걸 들켜서 그랬습니다. 경찰에 알리겠다고 하셔서 다퉜고, 출입문으로 가시려던 회장님을 뒤에서 트로피로 한 번 쳤습니다.', bad: false },
  { name: '[장면] R02 뒤 50분에 나왔다', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '그럼 회장님은 그때 어디 계셨어요?', reply: '그건 지금 말씀드리기 어렵습니다. 저는 8시 50분에 나왔으니까요.', bad: false },
  { name: '[장면] R02 뒤 책상에 멀쩡', owned: ['GT-E07', 'GT-E28', 'C-01', 'C-R02'], text: '그럼 회장님은 그때 어디 계셨어요?', reply: '제가 나올 때 회장님은 책상에 계셨습니다.', bad: true },
  { name: '[장면] 문 기록만 → 50분에 나왔다', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '8시 50분에는 뭐했어', reply: '8시 50분이요. 그 시각에 집무실에서 나왔습니다. 그 뒤의 일은 지금 말씀드리기 어렵습니다.', bad: true },
  { name: '[장면] 횡령 추궁 → 돈 문제 없었다', owned: ['GT-E06', 'GT-E07', 'C-01'], text: '당신이 횡령을 했고, 해당 사실을 피해자에게 들켰다는 사실은 이미 알고 있습니다.', reply: '돈 문제는 전혀 없었습니다. 평소처럼 운영 보고를 드렸을 뿐입니다.', bad: false },
  { name: '[장면] 트로피 닦으러 간 적 없다', owned: ACCUSE, text: '회장님을 트로피로 친 뒤 트로피에 묻은 지문을 지우기 위해 화장실로 향했나', reply: '아니요, 저는 트로피를 닦거나 그걸 옮기려고 화장실에 간 적이 없습니다.', bad: false },
  { name: '자백 뒤 왜 → 동기', owned: ['GT-E15', 'C-01', 'C-R01', 'C-R02', 'C-R03', 'C-R04'], text: '왜 그러셨어요?', reply: '운영비를 빼돌린 걸 회장님이 경찰에 알리겠다고 하셔서 다퉜습니다. 계획한 일은 아니었습니다.', bad: false },
];

const judgeCalls: { ms: number; usd: number }[] = [];
const judge: Judge = async (input, reply) => {
  const out = await runAi({ task: 'talkJudge', user: buildJudgePrompt(input, reply) }, env);
  judgeCalls.push({ ms: out.ms, usd: out.usage ? usdOf(out.model, out.usage) ?? 0 : 0 });
  return sanitizeVerdict(JSON.parse(out.text), input.person, reply);
};

const input = (c: Case): TalkInput => ({ person: 'C', text: c.text, owned: new Set([...INITIAL_OWNED, ...c.owned]), history: c.history ?? h(), attached: c.attached });
const raw = (c: Case) => ({ reply: c.reply, record: [], give: [], admit: c.admit ?? [], basis: [] });

let regexOk = 0;
const judgeOk: number[] = [];
const hybridOk: number[] = [];
const rows: string[] = [];
await Promise.all(CASES.map(async (c, i) => {
  const rx = await checkTalk(input(c), raw(c), null);
  const rxRight = !!rx.problem === c.bad;
  if (rxRight) regexOk++;
  const marks: string[] = [];
  for (let r = 0; r < reps; r++) {
    // 한 번 받은 판정으로 두 방식을 함께 본다
    let memo: Promise<Awaited<ReturnType<Judge>>> | null = null;
    const once: Judge = (inp, rep) => (memo ??= judge(inp, rep));
    const j = await checkTalk(input(c), raw(c), once, 'full');
    const hy = await checkTalk(input(c), raw(c), once, 'hybrid');
    hybridOk[i] = (hybridOk[i] ?? 0) + (!!hy.problem === c.bad ? 1 : 0);
    if (!!hy.problem !== c.bad) marks.push(`(혼합 ✗ ${hy.problem?.why ?? '통과'})`);
    const right = !!j.problem === c.bad;
    judgeOk[i] = (judgeOk[i] ?? 0) + (right ? 1 : 0);
    marks.push(`${right ? '✓' : '✗'}${j.problem ? ` ${j.problem.why}` : ' 통과'}${j.judged ? '' : ' (판정 안 씀)'}`);
  }
  rows[i] = `${i + 1}. ${c.name} [정답: ${c.bad ? '다시 받기' : '통과'}]\n   낱말 검사: ${rxRight ? '✓' : '✗'} ${rx.problem?.why ?? '통과'}\n   판정: ${marks.join(' | ')}`;
}));
console.log(rows.join('\n'));
const total = judgeOk.reduce((a, b) => a + b, 0);
const ms = judgeCalls.map((x) => x.ms).sort((a, b) => a - b);
const hyTotal = hybridOk.reduce((a, b) => a + b, 0);
console.log(`\n낱말 검사 ${regexOk}/${CASES.length} · 판정 AI ${total}/${CASES.length * reps} (${(100 * total / (CASES.length * reps)).toFixed(0)}%) · 혼합 ${hyTotal}/${CASES.length * reps} (${(100 * hyTotal / (CASES.length * reps)).toFixed(0)}%)`);
console.log(`판정 ${judgeCalls.length}회 · 중앙 ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)}초 p90 ${(ms[Math.floor(ms.length * 0.9)] / 1000).toFixed(1)}초 · $${judgeCalls.reduce((a, x) => a + x.usd, 0).toFixed(4)} (${env.ANTHROPIC_MODEL}, ${Object.keys(PRICE).includes(env.ANTHROPIC_MODEL) ? '' : '단가 모름 '}생각 ${process.env.SMALL_THINKING_OFF?.includes('talkJudge') ? '끔' : '켬'})`);
