// 수사팀 자유 대화 점검: 플레이 로그에서 알아듣지 못했던 요청을 서버 경로(runAi)로 다시 돌린다. 실행: npx tsx scripts/team-eval.ts [번호]
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { runAi } from '../server/aiHandler';
import { buildDeskPrompt, heardLines, sanitizeDesk } from '../src/ai/desk';
import type { ChatMsg } from '../src/engine/state';
import type { TeamJob } from '../src/engine/investigation';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
// 게임과 같은 모델로 돌린다 (2026-10-17부터 Haiku). 다른 모델은 ANTHROPIC_MODEL로
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5' };
let n = 0;
const h = (...xs: [string, string][]): ChatMsg[] => xs.map(([role, text]) => ({ id: `h${n++}`, role: role as ChatMsg['role'], text }));
const base = [...INITIAL_OWNED];
const CASES: { owned: string[]; text: string; history?: ChatMsg[]; jobs?: TeamJob[]; heard?: boolean }[] = [
  { owned: base, text: '피해자 핸드폰 통화기록 요청합니다' },
  { owned: base, text: '응 그것도 해줘', history: h(['me', '피해자 핸드폰 통화기록 요청합니다'], ['them', '통화 내역과 녹음을 조회하겠습니다.\n회장님 번호의 문자 송수신 내역도 같이 볼까요?']) },
  { owned: [...base, 'GT-E09', 'GT-E10'], text: '매입점 출입 기록은요?' },
  { owned: base, text: '매입점 cctv 볼 수 있나요?' },
  { owned: base, text: '문태준 씨는 정기 보고 때문에 회장님을 만났다고 해요. 그날 두 사람이 만나기로 한 문자나 보고 자료를 확인해 주세요.' },
  { owned: [...base, 'GT-E04'], text: '사인 감정에 즉사라고 되어 있네요. 그러면 몇 시 몇 분에 죽었는지 알 수 있나요?' },
  { owned: base, text: '집무실 CCTV나 출입 기록이 있나요? 언제 돌아가신 건지도 알고 싶어요. 부검 결과와 현장 사진도 주세요.' },
  { owned: base, text: '태준 핸드폰도 좀 털어봐' },
  { owned: base, text: '범인 누구 같아요?' },
  { owned: base, text: '고생 많으세요 ㅎㅎ' },
  { owned: [...base, 'GT-E06'], text: '회장 휴대폰 통화녹음 다시 보내줘' },
  { owned: base, text: '집무실 안에 녹음기 같은 거 없었어?' },
  // 2026-10-17 Haiku 플레이 리뷰 (design/playtest-2026-10-17-haiku/review.md)
  // 1. 초반 정리: 예약 발송을 먼저 꺼내지 않고, 마지막 문자의 수신자를 아들로 말해야 한다
  { owned: base, text: '지금까지 확실한 사실과 아직 모르는 것만 나눠서 정리해 주세요.' },
  { owned: base, text: '마지막 문자는 회장이 받은 게 아니라 아들이 받은 거잖아요. 그 문자에 대해 뭘 더 확인할 수 있어요?', history: h(['me', '지금까지 확실한 사실과 아직 모르는 것만 나눠서 정리해 주세요.'], ['them', '확실한 것: 회장이 집무실 화장실에서 발견됐고 머리 타격에 의한 타살입니다.\n아직 모르는 것: 마지막 문자의 원문과 경위입니다.']) },
  // 2. 받은 부검서 해석: 되묻지 말고 자료의 범위로 답해야 한다
  { owned: [...base, 'GT-E04'], text: '이 부검서만으로 정확히 몇 시 몇 분에 죽었는지 알 수 있어요?' },
  { owned: [...base, 'GT-E04'], text: '사망 추정 시각 범위가 어떻게 돼요?' },
  // 3. 들은 진술 공유: 태준의 퇴실 정정을 알고 있어야 한다
  { owned: [...base, 'GT-E07', 'GT-E28', 'C-R02'], text: '태준이 8시 50분에 나왔고 화장실에 있었다고 인정했는데, 그거 수사팀도 알고 있죠?', heard: true },
  // 휴대폰 분석: 막연하면 되묻고(예약을 먼저 말하지 않음), 예약 시점을 짚으면 맡는다
  { owned: [...base, 'GT-E14'], text: '회장 휴대폰 분석해 줘' },
  { owned: [...base, 'GT-E14'], text: '그 문자가 회장 휴대폰에 언제 예약 등록됐는지 확인해 주세요' },
];
const only = Number(process.argv[2]);
for (const [i, c] of CASES.entries()) {
  if (only && only !== i + 1) continue;
  const out = await runAi({ task: 'desk', user: buildDeskPrompt({ text: c.text, owned: new Set(c.owned), history: c.history ?? [], jobs: c.jobs ?? [], heard: c.heard ? heardLines(undefined, new Set(c.owned)) : [] }) }, env);
  const r = sanitizeDesk(JSON.parse(out.text));
  console.log(`\n#${i + 1} (${out.ms}ms) 수사관: ${c.text}\n  수사팀: ${r.reply.replace(/\n/g, ' ⏎ ')}\n  start=${r.start} deflect=${r.deflect}`);
}
