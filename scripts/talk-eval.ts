// 자유 대화(talk) 점검. 플레이 로그에서 어색했던 장면을 서버 경로(runAi)로 다시 돌려 답과 상태 변화를 본다.
// 실행: npx tsx scripts/talk-eval.ts            (전부)
//       npx tsx scripts/talk-eval.ts 3          (3번 장면만)
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { runAi } from '../server/aiHandler';
import { buildTalkPrompt, sanitizeTalk, type TalkInput } from '../src/ai/talk';
import type { ChatMsg } from '../src/engine/state';
import type { PersonId } from '../src/data/types';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
// 게임과 같은 모델로 돌린다 (2026-10-17부터 Haiku). 다른 모델은 ANTHROPIC_MODEL로
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5' };

let n = 0;
const h = (...lines: [string, string, string[]?][]): ChatMsg[] => lines.map(([role, text, attached]) => ({ id: `h${n++}`, role: role as ChatMsg['role'], text, ...(attached ? { attached } : {}) }));
const base = [...INITIAL_OWNED];

type Case = { name: string; person: PersonId; owned: string[]; history?: ChatMsg[]; attached?: string[]; text: string };
const CASES: Case[] = [
  { name: '민아에게 감식 결과를 보이며', person: 'B', owned: [...base, 'GT-E19', 'GT-E04'], attached: ['GT-E19'], text: '이거에 대해 아시는 거 있나요?' },
  { name: '민아 트로피', person: 'B', owned: [...base, 'GT-E19'], history: h(['me', '이거에 대해 아시는 거 있나요?', ['GT-E19']], ['them', '들어갔을 때 바닥에 그런 흔적은 못 봤어요. 자세히 본 건 아니라서 무섭네요.']), text: '트로피에 대해 아는 거 없어요?' },
  { name: '민아 대화 내역 보여 달라', person: 'B', owned: [...base, 'B-01', 'B-Q02'], history: h(['me', '준서 씨가 왜 트로피를 가져다 달라고 했나요?'], ['them', '회장님이 금 트로피를 주기로 했다고, 대신 가져다 달라고 했어요. 대화 내역이 있습니다.']), text: '그럼 휴대폰에 있는 준서 씨와의 대화 내역을 직접 보여 주세요.' },
  { name: '태준에게 부검·통화 기록', person: 'C', owned: [...base, 'GT-E05', 'GT-E06', 'GT-E04'], attached: ['GT-E04'], text: '이걸 보시죠. 어떻게 생각하세요?' },
  { name: '태준 소명 요구 통화', person: 'C', owned: [...base, 'GT-E05', 'GT-E06', 'GT-E04'], attached: ['GT-E06'], text: '소명 요구를 하셨다는 데 무슨 이야기죠?' },
  { name: '태준 소명 자료로 정정', person: 'C', owned: [...base, 'GT-E06', 'GT-E13', 'C-01', 'C-Q04'], history: h(['me', '회장실에 간 이유가 뭔가요?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고입니다.']), attached: ['GT-E13'], text: '정기 보고였다면서요? 이건 뭡니까?' },
  { name: '태준 말로만 예약 발송', person: 'C', owned: [...base, 'GT-E14', 'C-01', 'C-Q10'], history: h(['me', '9시 10분 문자는 누가 보낸 거죠?'], ['them', '회장님이 9시 10분에 직접 보내신 문자입니다. 그때까지 살아 계셨던 거죠.']), text: '마지막 문자가 예약 발송이었다는데요. 그럼 9시 10분에 회장님이 살아 있었다고는 할 수 없는 것 아닌가요?' },
  { name: '태준 추리로 문자 깨기', person: 'C', owned: [...base, 'GT-E04', 'GT-E11', 'GT-E09', 'GT-E07', 'C-01', 'C-Q10'], text: '트로피가 치명 타격의 흉기로 확인됐고 20시 55분부터 매입점이 계속 보관했어요. 회장은 그 타격으로 즉사했습니다. 따라서 21시 10분 문자는 회장이 직접 쓴 것이 아니죠.' },
  { name: '태준 지문', person: 'C', owned: [...base, 'GT-E16', 'GT-E17', 'C-01', 'C-Q09'], attached: ['GT-E17'], text: '손댄 적이 없다면서요?' },
  { name: '태준 최종', person: 'C', owned: [...base, 'GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E17', 'C-01', 'C-R02', 'C-R03', 'C-Q11'], attached: ['GT-E15', 'GT-E10'], text: '8시 48분에 그 휴대폰으로 예약이 등록됐어요. 그때 준서 씨랑 민아 씨는 매입점에 있었고, 회장님은 이미 맞아서 휴대폰을 못 만지는 상태였죠. 그 방에 남은 건 당신뿐입니다.' },
  { name: '태준 압박만', person: 'C', owned: [...base], text: '당신이 죽인 거 다 알아요. 자백하세요.' },
  { name: '준서 첫 질문', person: 'A', owned: [...base], text: '발견 당시 상황 좀 설명해주시죠' },
  { name: '준서 출입 기록', person: 'A', owned: [...base, 'GT-E07'], attached: ['GT-E07'], text: '카드가 두 번 찍혔네요?' },
  { name: '태준 잡담', person: 'C', owned: [...base], text: '점심은 드셨어요?' },
  { name: '태준 언성 (진술서 누설 점검)', person: 'C', owned: [...base, 'C-01', 'C-Q04'], history: h(['me', '그날 무슨 일로 가셨어요?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고입니다.']), text: '솔직히 그날 회장님과 언성을 높인 일은 없었나요? 그냥 정기 보고였다는 설명이 너무 두루뭉술해서요. 숨기는 게 있으면 지금 말해 주세요.' },
  { name: '민아 시각 출처', person: 'B', owned: [...base, 'B-01', 'GT-E08', 'B-Q04', 'B-Q12'], text: '시각을 분 단위로 정확히 말해 주셨는데, 직접 시계를 보고 기억한 건가요, 기록을 보고 맞춘 건가요? 확실한 기억과 대략적인 기억을 나눠 주세요.' },
  { name: '민아 여러 항목', person: 'B', owned: [...base], text: '트로피는 누가 집어서 누구 손에 넘겼나요? 피나 젖은 부분, 깨진 부분처럼 눈에 띄는 건 없었나요?' },
  { name: '자백 분량', person: 'C', owned: [...base, 'GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E17', 'GT-E13', 'C-01', 'C-R01', 'C-R02', 'C-R03', 'C-Q11'], attached: ['GT-E15', 'GT-E10'], text: '8시48분에 집무실의 회장 휴대폰에서 직접 등록했고, 준서와 민아는 그때 매입점에 있었다는 기록입니다. 당신은 8시50분까지 그 방에 있었죠. 미리 예약한 적 없다는 말을 어떻게 설명하실 건가요?' },
  { name: '계좌 내역으로 횡령 인정', person: 'C', owned: [...base, 'GT-E31', 'C-01', 'C-Q04'], history: h(['me', '오늘 집무실에는 왜 가셨죠?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고를 드렸습니다.']), attached: ['GT-E31'], text: '이걸 보시죠. 어떻게 생각하세요?' },
  { name: '일정표 두 번 밀기', person: 'C', owned: [...base, 'GT-E32', 'C-01', 'C-Q04'], history: h(['me', '이거 보세요', ['GT-E32']], ['them', '정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다.']), text: '늘 하던 확인이면 왜 회장님이 직접 일정을 넣었겠어요? 돈 문제로 불려 간 거 아닙니까?' },
  { name: '자백 뒤 목적', person: 'C', owned: [...base, 'GT-E15', 'C-01', 'C-R01', 'C-R02', 'C-R03', 'C-R04'], text: '아드님이 꼭 호텔로 돌아온다는 걸 알고 있었나요? 돌아오지 않았다면 예약 문자는 무슨 소용이 있었을까요?' },
];

const only = Number(process.argv[2]);
for (const [i, c] of CASES.entries()) {
  if (only && only !== i + 1) continue;
  const owned = new Set(c.owned);
  const input: TalkInput = { person: c.person, text: c.text, owned, history: c.history ?? [], attached: c.attached };
  const user = buildTalkPrompt(input);
  try {
    const out = await runAi({ task: 'talk', user }, env);
    const r = sanitizeTalk(JSON.parse(out.text), c.person, owned);
    console.log(`\n#${i + 1} ${c.name} (${out.ms}ms, in ${out.usage?.input}+${out.usage?.cacheRead}c, out ${out.usage?.output})\n  형사: ${c.text}${c.attached ? ` [${c.attached.join(',')}]` : ''}\n  답: ${r.reply}\n  record=${r.record} give=${r.give} admit=${r.admit} basis=${r.basis}`);
  } catch (e) {
    console.log(`\n#${i + 1} ${c.name} 실패`, e);
  }
}
