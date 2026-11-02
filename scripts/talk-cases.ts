// 어려운 대화 장면 채점: 플레이에서 막혔던 장면(talk-eval.ts)에 기대하는 상태 변화를 붙여, 모델별로 여러 번 돌려 맞힌 비율을 본다.
// 실행: npx tsx scripts/talk-cases.ts <모델> [반복=2]   → design/model-eval-2026-10-17-talk/cases-<모델>[_TAG].md
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { runAi } from '../server/aiHandler';
import { buildTalkPrompt, confessesWithoutAdmit, leakedTimes, sanitizeTalk, type TalkInput } from '../src/ai/talk';
import type { ChatMsg } from '../src/engine/state';
import type { PersonId } from '../src/data/types';

const local = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const key = (k: string) => process.env[k] ?? local.match(new RegExp(`^${k}=(.+)$`, 'm'))?.[1].trim();
const model = process.argv[2] ?? 'claude-haiku-5-5';
const reps = Number(process.argv[3] ?? 2);
const env = model.startsWith('gpt-') ? { OPENAI_API_KEY: key('OPENAI_API_KEY'), OPENAI_MODEL: model }
  : /^(gemini|gemma)/.test(model) ? { GEMINI_API_KEY: key('GEMINI_API_KEY'), GEMINI_MODEL: model }
  : { ANTHROPIC_API_KEY: key('ANTHROPIC_API_KEY'), ANTHROPIC_MODEL: model };

let n = 0;
const h = (...lines: [string, string, string[]?][]): ChatMsg[] => lines.map(([role, text, attached]) => ({ id: `h${n++}`, role: role as ChatMsg['role'], text, ...(attached ? { attached } : {}) }));
const base = [...INITIAL_OWNED];
/** admit: 꼭 인정해야 할 단계(빈 배열이면 인정하면 안 됨) · give · record: 꼭 들어가야 할 ID · not: 대사에 나오면 안 되는 말 */
type Case = { name: string; person: PersonId; owned: string[]; history?: ChatMsg[]; attached?: string[]; text: string; admit?: string[]; give?: string[]; record?: string[]; not?: RegExp; maxLen?: number };
const CASES: Case[] = [
  { name: '민아에게 감식 결과', person: 'B', owned: [...base, 'GT-E19', 'GT-E04'], attached: ['GT-E19'], text: '이거에 대해 아시는 거 있나요?', admit: [] },
  { name: '민아 대화 내역 요청', person: 'B', owned: [...base, 'B-01', 'B-Q02'], history: h(['me', '준서 씨가 왜 트로피를 가져다 달라고 했나요?'], ['them', '회장님이 금 트로피를 주기로 했다고, 대신 가져다 달라고 했어요. 대화 내역이 있습니다.']), text: '그럼 휴대폰에 있는 준서 씨와의 대화 내역을 직접 보여 주세요.', give: ['GT-E08'], admit: [] },
  { name: '태준 부검서만', person: 'C', owned: [...base, 'GT-E05', 'GT-E06', 'GT-E04'], attached: ['GT-E04'], text: '이걸 보시죠. 어떻게 생각하세요?', admit: [], not: /계좌|6,?400|횡령|예약/ },
  { name: '태준 소명 통화 녹취(처음은 버팀)', person: 'C', owned: [...base, 'GT-E05', 'GT-E06', 'GT-E04'], attached: ['GT-E06'], text: '소명 요구를 하셨다는 데 무슨 이야기죠?', admit: [] },
  { name: '태준 소명 자료로 정정', person: 'C', owned: [...base, 'GT-E06', 'GT-E13', 'C-01', 'C-Q04'], history: h(['me', '회장실에 간 이유가 뭔가요?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고입니다.']), attached: ['GT-E13'], text: '정기 보고였다면서요? 이건 뭡니까?', admit: ['C-R01'] },
  { name: '태준 말로만 예약 발송(자료 요구)', person: 'C', owned: [...base, 'GT-E14', 'C-01', 'C-Q10'], history: h(['me', '9시 10분 문자는 누가 보낸 거죠?'], ['them', '회장님이 9시 10분에 직접 보내신 문자입니다. 그때까지 살아 계셨던 거죠.']), text: '마지막 문자가 예약 발송이었다는데요. 그럼 9시 10분에 회장님이 살아 있었다고는 할 수 없는 것 아닌가요?', admit: [] },
  { name: '태준 지문만으로는 버팀', person: 'C', owned: [...base, 'GT-E16', 'GT-E17', 'C-01', 'C-Q09'], attached: ['GT-E17'], text: '손댄 적이 없다면서요?', admit: [] },
  { name: '태준 최종 자백', person: 'C', owned: [...base, 'GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E17', 'C-01', 'C-R02', 'C-R03', 'C-Q11'], attached: ['GT-E15', 'GT-E10'], text: '8시 48분에 그 휴대폰으로 예약이 등록됐어요. 그때 준서 씨랑 민아 씨는 매입점에 있었고, 회장님은 이미 맞아서 휴대폰을 못 만지는 상태였죠. 그 방에 남은 건 당신뿐입니다.', admit: ['C-R04'] },
  { name: '태준 압박만', person: 'C', owned: [...base], text: '당신이 죽인 거 다 알아요. 자백하세요.', admit: [], not: /계좌|6,?400|횡령|예약|트로피로/ },
  { name: '준서 첫 질문', person: 'A', owned: [...base], text: '발견 당시 상황 좀 설명해주시죠', record: ['A-Q01'], admit: [] },
  { name: '태준 잡담', person: 'C', owned: [...base], text: '점심은 드셨어요?', admit: [], not: /계좌|6,?400|횡령|예약/ },
  { name: '태준 언성(돈 이야기 먼저 꺼내지 않기)', person: 'C', owned: [...base, 'C-01', 'C-Q04'], history: h(['me', '그날 무슨 일로 가셨어요?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고입니다.']), text: '솔직히 그날 회장님과 언성을 높인 일은 없었나요? 그냥 정기 보고였다는 설명이 너무 두루뭉술해서요. 숨기는 게 있으면 지금 말해 주세요.', admit: [], not: /계좌|6,?400|횡령|운영비/ },
  { name: '태준 자백 분량', person: 'C', owned: [...base, 'GT-E04', 'GT-E07', 'GT-E10', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E17', 'GT-E13', 'C-01', 'C-R01', 'C-R02', 'C-R03', 'C-Q11'], attached: ['GT-E15', 'GT-E10'], text: '8시48분에 집무실의 회장 휴대폰에서 직접 등록했고, 준서와 민아는 그때 매입점에 있었다는 기록입니다. 당신은 8시50분까지 그 방에 있었죠. 미리 예약한 적 없다는 말을 어떻게 설명하실 건가요?', admit: ['C-R04'] },
  { name: '태준 계좌 내역으로 인정', person: 'C', owned: [...base, 'GT-E31', 'C-01', 'C-Q04'], history: h(['me', '오늘 집무실에는 왜 가셨죠?'], ['them', '정기 운영 보고였습니다. 늘 하던 보고를 드렸습니다.']), attached: ['GT-E31'], text: '이걸 보시죠. 어떻게 생각하세요?', admit: ['C-R01'] },
  { name: '태준 일정표 두 번째 추궁', person: 'C', owned: [...base, 'GT-E32', 'C-01', 'C-Q04'], history: h(['me', '이거 보세요', ['GT-E32']], ['them', '정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다.']), text: '늘 하던 확인이면 왜 회장님이 직접 일정을 넣었겠어요? 돈 문제로 불려 간 거 아닙니까?', admit: ['C-R01'] },
  { name: '준서 문자 보여 달라', person: 'A', owned: [...base], text: '아버님이 보내신 문자 좀 볼 수 있을까요?', give: ['GT-E05'], admit: [] },
  // 2026-10-17 Haiku 로컬 플레이: 하루를 한 문단으로 쏟아내며 묻지 않은 방 안 모습(총지배인 부재, 화장실 문)을 말했다
  { name: '민아 오늘 한 일(짧게, 방 안 세부 없이)', person: 'B', owned: [...base], text: '오늘 한 일 다 말해주세요', admit: [], not: /총지배인|화장실/, maxLen: 300 },
  // 2026-10-17 Haiku 로컬 플레이: 증거 없이 말로만 몰아붙였는데 예약 등록 시각(8시 48분)을 먼저 말했다
  { name: '태준 말로만 예약 문자 추궁(시각 누설 없이)', person: 'C', owned: [...base], history: h(['me', '너가 범인이지?'], ['them', '무슨 말씀이신지 모르겠습니다. 저는 회장님께 보고를 드리고 나왔을 뿐입니다. 제가 범인이라는 근거가 있다면 보여 주십시오.']), text: '너가 죽이고 화장실에 숨겼다가 서민아씨 들어와서 트로피 가져가니까 기회다 싶어서 회장님 폰으로 이따 회의시간으로 예약문자 남겨놓은거잖아', admit: [], not: /48분|8시 ?50분|31분|20:48|등록한 건 맞|제가 (했|쳤)|버티지 않|버틸 수가/ },
  { name: '민아 정직한 증인 압박', person: 'B', owned: [...base], text: '솔직히 말해요. 트로피 들고 나갈 때 회장님 쓰러져 있는 거 봤죠?', admit: [] },
];

const lines: string[] = [`# 어려운 장면 채점 · ${model} · ${reps}번씩`, ''];
let ok = 0, total = 0;
const ms: number[] = [];
const tot = { in: 0, read: 0, write: 0, out: 0 };
await Promise.all(CASES.map(async (c, i) => {
  const rows: string[] = [];
  for (let r = 0; r < reps; r++) {
    const owned = new Set(c.owned);
    const input: TalkInput = { person: c.person, text: c.text, owned, history: c.history ?? [], attached: c.attached };
    try {
      // 게임처럼 숨긴 시각을 먼저 말한 답은 버리고 다시 받는다 (talk.ts의 talk와 같은 검사)
      let out = await runAi({ task: 'talk', user: buildTalkPrompt(input) }, env);
      let retried = 0;
      const bad = (raw: string) => { const o = JSON.parse(raw) as { reply?: string }; const r = o.reply ?? ''; return leakedTimes(input, r).length > 0 || confessesWithoutAdmit(input, r, sanitizeTalk(o, c.person, owned, c.text).admit); };
      while (retried < 2 && bad(out.text)) { retried++; out = await runAi({ task: 'talk', user: buildTalkPrompt(input) }, env); }
      const res = sanitizeTalk(JSON.parse(out.text), c.person, owned, c.text);
      ms.push(out.ms);
      if (out.usage) { tot.in += out.usage.input; tot.read += out.usage.cacheRead; tot.write += out.usage.cacheWrite; tot.out += out.usage.output; }
      const miss: string[] = [];
      if (c.admit && !c.admit.length && res.admit.length) miss.push(`인정하면 안 됨(${res.admit})`);
      for (const id of c.admit ?? []) if (!res.admit.includes(id)) miss.push(`인정 ${id} 없음`);
      for (const id of c.give ?? []) if (!res.give.includes(id)) miss.push(`건넴 ${id} 없음`);
      for (const id of c.record ?? []) if (!res.record.includes(id)) miss.push(`기록 ${id} 없음`);
      if (c.not && c.not.test(res.reply)) miss.push(`금지어 ${res.reply.match(c.not)![0]}`);
      if (c.maxLen && res.reply.length > c.maxLen) miss.push(`너무 김 ${res.reply.length}자`);
      if (retried) rows.push(`  (누설·근거 없는 자백으로 ${retried}번 다시 받음)`);
      total++; if (!miss.length) ok++;
      rows.push(`- ${miss.length ? '✗ ' + miss.join(', ') : '✓'} (${(out.ms / 1000).toFixed(1)}초) ${res.reply.replace(/\n/g, ' ')}`);
    } catch (e) {
      total++;
      rows.push(`- ✗ 실패 ${String(e).slice(0, 100)}`);
    }
  }
  lines[i + 2] = [`### ${i + 1}. ${c.name}`, `형사: ${c.text}${c.attached ? ` [${c.attached.join(',')}]` : ''}`, ...rows, ''].join('\n');
}));
const s = [...ms].sort((a, b) => a - b);
const summary = `${ok}/${total} · 중앙값 ${(s[Math.floor(s.length / 2)] / 1000).toFixed(1)}초 · 90% ${(s[Math.floor(s.length * 0.9)] / 1000).toFixed(1)}초 · 최대 ${(s[s.length - 1] / 1000).toFixed(1)}초 · 입력 ${tot.in}+캐시 ${tot.read}/${tot.write} · 출력 ${tot.out}`;
lines[1] = summary;
writeFileSync(`design/model-eval-2026-10-17-talk/cases-${model}${process.env.TAG ? `_${process.env.TAG}` : ''}.md`, lines.join('\n'));
console.log(model, summary);
for (const l of lines) if (l.includes('✗')) console.log(l.split('\n').filter((x) => x.startsWith('###') || x.includes('✗')).join('\n'));
