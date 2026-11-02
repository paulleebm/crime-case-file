// [추궁 판정]이 형사의 여러 말투를 알아듣는지 (2026-10-21). 엔진만으로 계산하므로 AI 비용이 들지 않는다.
// 같은 추궁을 다르게 말한 문장마다 단계별로 기대하는 판정을 적는다:
//   admit — 이번 답에서 인정하라는 판정 / hold — 버티라는 판정이 붙는다 / none — 그 단계의 판정이 붙지 않는다
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { INITIAL_OWNED } from '../src/data/case';
import { culpritJudgement, unsupportedAdmit } from '../src/ai/talk';
import type { ChatMsg } from '../src/engine/state';

type Want = 'admit' | 'hold' | 'none';
type Case = { text: string; owned?: string[]; attached?: string[]; before?: string[]; want: Record<string, Want> };

const MINA = ['GT-E07', 'GT-E28'];
const MONEY = (id: string) => [id];
const CHAIN = ['GT-E04', 'GT-E11', 'GT-E28', 'GT-E14'];
const SCHED = ['GT-E07', 'GT-E28', 'GT-E04', 'GT-E11', 'GT-E14', 'GT-E15'];

export const CASES: Case[] = [
  // C-R02 퇴실 시각: 문 기록 + 민아가 47분에 1층에 있었다는 연결
  { text: '50분에 나간 건 누구죠?', owned: MINA, attached: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아 씨는 8시 47분에 이미 1층 귀금속 가게에 있었어요. 그런데 집무실 문은 8시 50분에 또 열렸죠.', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아씨가 46분에 나갔고 47분엔 매입점이었는데 50분 문 열림은 누구야', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '20:47에 서민아는 온정귀금속에 있었다. 20:50 출입 기록은 당신 아닌가?', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아는 그때 아래층 매장에서 거래 중이었어. 마지막에 문 열고 나간 사람 당신이잖아', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아 씨 매장 도착이 47분이면 45분에 들어가서 1분 만에 나온 거잖아요. 그럼 50분은요?', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '근데 민아는 47분에 1층에 있었다던데?', owned: MINA, before: ['GT-E07'], want: { 'C-R02': 'admit' } },
  { text: '문 기록 보면 50분에도 열렸어.', owned: MINA, before: ['GT-E28'], want: { 'C-R02': 'admit' } },
  { text: '서민아가 매장 장부에 47분으로 적혀 있어요. 당신 말대로면 민아가 4분이나 방에 있었어야 하는데 말이 안 되죠', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '트로피 팔러 간 시각이 8시 47분이에요. 그럼 그 뒤 50분에 문을 연 건 누굽니까', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아 47분 매입점. 50분 퇴실 = 당신', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '민아 씨는 그 시각 이미 아래층 귀금속점 손님이었어요. 그렇다면 마지막으로 집무실 문을 열고 나온 사람은 당신밖에 없습니다.', owned: MINA, want: { 'C-R02': 'admit' } },
  { text: '50분에 나간 거 당신이잖아요!', owned: ['GT-E07'], attached: ['GT-E07'], want: { 'C-R02': 'hold' } },
  { text: 'CCTV에 8시 50분에 나가는 거 찍혔어요', want: { 'C-R02': 'hold' } },
  { text: '민아 씨가 47분에 매장에 있었네요', owned: ['GT-E28'], attached: ['GT-E28'], want: { 'C-R02': 'hold' } },
  { text: '점심은 뭐 드셨어요?', owned: MINA, want: { 'C-R02': 'none' } },
  // C-R01 돈 문제
  { text: '이게 뭡니까?', owned: MONEY('GT-E13'), attached: ['GT-E13'], want: { 'C-R01': 'admit' } },
  { text: '개인 계좌로 6,400만원 들어온 내역 있던데요', owned: MONEY('GT-E31'), want: { 'C-R01': 'admit' } },
  { text: '회장님이 낮에 소명하라고 문자 보내셨던데', owned: MONEY('GT-E13'), want: { 'C-R01': 'admit' } },
  { text: '회계팀에서 지급처가 당신 개인 계좌라고 하던데요', owned: MONEY('GT-E34'), want: { 'C-R01': 'admit' } },
  { text: '12시 40분에 회장님한테 받은 문자, 돈 넘어간 거 설명하라는 거였죠', owned: MONEY('GT-E30'), want: { 'C-R01': 'admit' } },
  { text: '회삿돈 빼돌린 거 회장님이 알아내서 부르신 거잖아요. 낮에 온 문자에 다 나와 있어요', owned: MONEY('GT-E13'), want: { 'C-R01': 'admit' } },
  { text: '그래서 돈 때문에 불려간 거 아니냐고요', owned: ['GT-E32'], before: ['GT-E32'], want: { 'C-R01': 'admit' } },
  { text: '늘 하던 확인이라기엔 회장님이 직접 잡은 일정이잖아요. 횡령 건 아닙니까', owned: ['GT-E32'], before: ['GT-E32'], want: { 'C-R01': 'admit' } },
  { text: '회장님 일정표에 정산 확인이라고 돼 있네요', owned: ['GT-E32'], attached: ['GT-E32'], want: { 'C-R01': 'hold' } },
  { text: '솔직히 그날 언성 높인 적 없어요?', want: { 'C-R01': 'hold' } },
  // C-R03 9시 10분 문자
  { text: '이 문자 예약 발송이던데요', owned: ['GT-E14'], attached: ['GT-E14'], want: { 'C-R03': 'admit' } },
  { text: '9시 10분 문자는 미리 걸어 둔 거였어요', owned: ['GT-E14'], want: { 'C-R03': 'admit' } },
  { text: '그 문자 예약전송된 거잖아', owned: ['GT-E14'], want: { 'C-R03': 'admit' } },
  { text: '그 문자, 회장님이 그 시각에 직접 쓴 게 아니라 시간 맞춰 자동으로 나간 거예요', owned: ['GT-E14'], want: { 'C-R03': 'admit' } },
  { text: '흉기는 트로피고 즉사였어요. 그 트로피는 47분에 매장에 있었고. 9시 10분 문자를 회장님이 보냈다고요?', owned: CHAIN.filter((x) => x !== 'GT-E14'), want: { 'C-R03': 'admit' } },
  { text: '회장님은 맞자마자 숨졌고 그 흉기는 8시 47분에 1층으로 내려갔어요. 그런데 9시 10분에 문자를 보냈다?', owned: CHAIN.filter((x) => x !== 'GT-E14'), want: { 'C-R03': 'admit' } },
  { text: '사인은 둔기 한 번에 의한 즉사. 그 둔기는 트로피. 트로피는 매입점에 팔렸고. 그럼 21:10 메시지는?', owned: CHAIN.filter((x) => x !== 'GT-E14'), want: { 'C-R03': 'admit' } },
  { text: '9시 10분 문자는 누가 보낸 거죠?', owned: ['GT-E05'], want: { 'C-R03': 'none' } },
  // C-R04 예약 등록 + 그 방에 남은 사람 / 이미 숨진 회장
  { text: '8시 48분에 회장님 폰에서 등록됐어요. 그때 그 방엔 당신뿐이었죠', owned: SCHED, attached: ['GT-E15'], want: { 'C-R04': 'admit' } },
  { text: '50분까지 그 방에 있던 건 당신 혼자였잖아요', owned: SCHED, before: ['GT-E15'], want: { 'C-R04': 'admit' } },
  { text: '예약은 48분에 등록됐어요. 그 시각 집무실에 있던 건 누구죠?', owned: [...SCHED, 'C-R02'], want: { 'C-R04': 'admit' } },
  { text: '예약 등록 시각이 8시 48분인데 회장님은 이미 트로피에 맞아 숨진 뒤였어요', owned: SCHED, want: { 'C-R04': 'admit' } },
  { text: '회장님 휴대폰에 20:48에 문자가 걸렸어요. 그때 방 안에 산 사람은 당신 하나', owned: SCHED, want: { 'C-R04': 'admit' } },
  { text: '문자 예약한 시각에 그 방에 있던 사람은 당신밖에 없어요', owned: [...SCHED, 'C-R02'], before: ['GT-E15'], want: { 'C-R04': 'admit' } },
  { text: '이 기록 보세요', owned: SCHED, attached: ['GT-E15'], want: { 'C-R04': 'hold' } },
  { text: '당신이 회장님 폰으로 예약했잖아', want: { 'C-R04': 'hold' } },
  { text: '당신이 죽인 거 다 알아요', owned: ['GT-E07'], want: { 'C-R04': 'hold' } },
  // 넓힌 말 묶음이 인정을 너무 쉽게 내리지 않는가 (근거가 반쪽이거나 묻기만 한 말)
  { text: '민아 씨는 언제 매장에 갔나요?', owned: MINA, want: { 'C-R02': 'hold' } },
  { text: '당신이 마지막에 퇴실한 시각이 몇 시죠?', owned: MINA, want: { 'C-R02': 'hold' } },
  { text: '8시 50분에 뭐 했어요?', owned: ['GT-E07'], want: { 'C-R02': 'hold' } },
  { text: '운영비 정산은 원래 어떻게 처리하세요?', owned: MONEY('GT-E13'), want: { 'C-R01': 'none' } },
  { text: '계좌는 어느 은행 쓰세요?', owned: MONEY('GT-E31'), want: { 'C-R01': 'none' } },
  { text: '당신 혼자 있었던 거 아니에요?', owned: SCHED, want: { 'C-R04': 'hold' } },
  { text: '트로피 매입점에 팔렸다면서요? 문자는 받았어요?', owned: CHAIN.filter((x) => x !== 'GT-E14'), want: { 'C-R03': 'none' } },
  { text: '그날 1층 로비에는 몇 시에 계셨어요?', owned: MINA, want: { 'C-R02': 'none' } },
];

const msg = (attached: string[]): ChatMsg => ({ id: 'b', role: 'me', text: '이거 보세요', attached });
export function judged(c: Case): Record<string, Want> {
  const lines = culpritJudgement({ person: 'C', text: c.text, owned: new Set([...INITIAL_OWNED, ...(c.owned ?? []), ...(c.attached ?? [])]), history: c.before ? [msg(c.before)] : [], attached: c.attached });
  const out: Record<string, Want> = {};
  for (const stage of Object.keys(c.want)) {
    const l = lines.find((x) => x.startsWith(`- ${stage}:`));
    // 인정 판정은 "(admit에 C-R01)", "(admit에 C-R04와 C-R02)"처럼 단계 ID로 끝난다. "(admit에 C-R02를 넣지 않는다)"는 버티라는 판정이다
    out[stage] = !l ? 'none' : /\(admit에 C-R0\d(\)|와)/.test(l) ? 'admit' : 'hold';
  }
  return out;
}

test('추궁 판정이 여러 말투를 알아듣는다', () => {
  const miss = CASES.map((c) => ({ c, got: judged(c) })).filter(({ c, got }) => Object.entries(c.want).some(([k, v]) => got[k] !== v));
  assert.deepEqual(miss.map(({ c, got }) => `${c.text} → ${JSON.stringify(got)} (기대 ${JSON.stringify(c.want)})`), []);
});

test('인정하라는 판정이 나온 말은 엔진 문턱도 통과한다 (판정과 문턱이 어긋나면 인정한 답이 거절된다)', () => {
  const blocked = CASES.filter((c) => Object.values(c.want).includes('admit')).flatMap((c) => {
    const input = { person: 'C' as const, text: c.text, owned: new Set([...INITIAL_OWNED, ...(c.owned ?? []), ...(c.attached ?? [])]), history: c.before ? [msg(c.before)] : [], attached: c.attached };
    return unsupportedAdmit(input, Object.keys(c.want).filter((k) => c.want[k] === 'admit')).map((id) => `${c.text} → ${id}`);
  });
  assert.deepEqual(blocked, []);
});
