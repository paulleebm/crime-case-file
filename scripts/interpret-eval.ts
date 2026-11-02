// 해석 모델 비교. 같은 장면·질문을 모델별로 여러 번 해석시켜, 게임과 같은 후처리를 거친 판정이 기대와 맞는지와 응답 시간을 잰다.
// 실행: npx tsx scripts/interpret-eval.ts [--runs 3] [--out 파일.json] [모델[:설정] ...]   (gcloud 로그인 필요)
//   모델 설정: gemini-2.5-flash:t0 (생각 예산 0), :t512 (생각 예산 512), :low / :minimal (thinkingLevel)
//   Claude: claude-haiku-5-5:low (effort), :off (생각 끔, Haiku만). ANTHROPIC_API_KEY는 환경 변수나 .env.local에서 읽는다
// 사례는 앞선 플레이에서 실제로 막힌 질문을 그대로 쓴다 (design/playtest-2026-10-13-fourth/question-results.md).
import { runAi } from '../server/aiHandler';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import type { PersonId } from '../src/data/types';
import { TASKS } from '../src/ai/prompts';
import { checkVoiced } from '../src/ai/voice';
import { factById } from '../src/engine/lookup';
import { buildUserPrompt, checkDirect, ground, keepHandover, sanitize } from '../src/ai/interpret';
import type { Interpretation } from '../src/engine/logic';

const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();
// 키는 화면에 찍지 않는다
if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const BASE = ['A-01', 'B-01', 'C-01'];
const FILLED = Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => s.paras.map((p) => p.by[0])));
const B_LATE = ['B-02', 'E-06', 'E-10', 'E-11'];
const C_ROOM = ['B-02', 'B-03', 'E-12', 'B-F16', 'C-02', 'C-03', 'C-04', 'E-07', 'E-13', 'E-15'];

interface Expect {
  /** question: 이 중 하나를 고르면 된다 */ fact?: string[];
  /** question: 이 주제를 모두 골라야 한다 */ facts?: string[];
  /** question이면 고른 답이 물은 것에 바로 답한다고 판정해야 한다 (아니면 준비된 답 대신 자유 대사로 빠진다) */ direct?: boolean;
  kind?: 'challenge' | 'casual';
  target?: string[]; cited?: string[];
}
/** blank: 아직 그 인물에게 아무것도 듣지 않은 상태에서 시작한다 */
interface Case { id: string; person: PersonId; blank?: boolean; extra?: string[]; text: string; expect: Expect }

const CASES: Case[] = [
  // 앞선 비교 사례
  { id: 'P01', person: 'A', text: '사건 당시 알리바이 있으세요?', expect: { fact: ['A-D01', 'A-F7', 'A-F21'] } },
  { id: 'P02', person: 'A', text: '대표님과 그 회계 자료 때문에 다툰 적이 있나요? 오늘 연회에서 언성이 높았다는 직원 말이 있습니다.', expect: { fact: ['A-F2'] } },
  { id: 'P03', person: 'A', text: '업무 얘기뿐이었다고요? 연회 직원이 대기실에서 서명 하나 못 하냐는 고함을 들었어요.', extra: ['E-16'], expect: { kind: 'challenge', target: ['A-01.1', 'A-F2'], cited: ['E-16'] } },
  { id: 'P04', person: 'B', text: '피해자 차를 받은 뒤에 그 차가 움직인 적이 있나요?', expect: { fact: ['B-F5'] } },
  { id: 'P05', person: 'B', text: '한 번도 안 움직였다고요? 출입 기록에는 23시에 나갔다가 23시 40분에 들어왔어요.', expect: { kind: 'challenge', target: ['B-01.4', 'B-F5'], cited: ['E-06'] } },
  { id: 'P06', person: 'B', text: '근무하는 동안 데스크를 비운 적 있어요?', expect: { fact: ['B-F6'] } },
  { id: 'P07', person: 'C', text: '10시 반에 호텔을 나간 뒤 어디서 무엇을 하셨습니까?', expect: { fact: ['C-F5'] } },
  { id: 'P08', person: 'C', text: '장 대표와 돈 문제는 없었습니까?', expect: { fact: ['C-F7'] } },
  { id: 'P09', person: 'C', text: '돌아오지 않았다고요? 박준호가 11시 52분에 지하에서 당신을 직접 봤고 내선 기록도 있습니다.', extra: ['B-02', 'B-03', 'E-12', 'B-F16'], expect: { kind: 'challenge', target: ['C-01.4', 'C-F5', 'C-F24'], cited: ['E-12', 'B-F16'] } },
  { id: 'P10', person: 'C', text: '피해자가 직접 썼다는 글은 23시 47분에 저장됐지만, 같은 문장이 이미 21시 06분 당신 휴대폰에 있습니다. 당신이 먼저 쓴 글 아닌가요?', extra: [...C_ROOM, 'C-09'], expect: { kind: 'challenge', cited: ['E-15', 'E-04'] } },
  // 네 번째 플레이에서 막힌 질문
  { id: 'Q01', person: 'A', blank: true, text: '놀라셨겠어요. 처음 방에 들어갔을 때부터 신고할 때까지, 기억나는 순서대로 말씀해 주세요.', expect: { fact: ['A-F8'], direct: true } },
  { id: 'Q05', person: 'A', blank: true, extra: ['E-16'], text: '직원이 9시 20분에 서명 안 하면 오늘까지만 나오라는 남자 목소리를 듣고, 곧 서윤 씨가 나오는 걸 봤대요. 무슨 서명을 요구받은 거예요?', expect: { fact: ['A-F2'] } },
  { id: 'Q07', person: 'A', blank: true, text: '그날 저녁 대표님과 다툰 적 있나요?', expect: { fact: ['A-F2'], direct: true } },
  { id: 'Q08', person: 'A', extra: ['E-16'], text: '업무 이야기뿐이었다는 말은 직원이 들은 서명 강요와 해고 발언, 직후 당신이 나온 목격과 모순입니다. 대표님과 다툰 사실을 숨기는 이유가 뭔가요?', expect: { kind: 'challenge', target: ['A-01.1', 'A-F2'], cited: ['E-16'] } },
  { id: 'Q09', person: 'A', extra: ['E-16'], text: '대표님과 다툰 일은 없었다고 진술하셨죠. 21시 20분 직원은 대표의 서명 강요와 해고 위협을 들었고 당신이 바로 나온 걸 봤습니다. 다툼이 없었다는 진술은 거짓 아닌가요?', expect: { kind: 'challenge', target: ['A-01.1', 'A-F2'], cited: ['E-16'] } },
  { id: 'Q14', person: 'B', blank: true, text: '피해자 차는 어디에 세웠어요? 그 뒤 차를 옮기거나 몰고 나간 적 있나요?', expect: { facts: ['B-F3', 'B-F5'] } },
  { id: 'Q24', person: 'B', extra: B_LATE, text: '봤어요. C12 투숙객이 피해 차 운전석 창을 내린 당신을 보고 명찰까지 확인했습니다. 기록 오류로 차가 안 움직였다는 해명은 이제 안 맞아요. 왜 몰래 운전했나요?', expect: { kind: 'challenge', target: ['B-02.1', 'B-02.2'], cited: ['E-11'] } },
  { id: 'Q25', person: 'B', extra: B_LATE, text: '번호 인식이 잘못됐을 수도 있다고 했죠. 계기판은 25km 늘었고 C12 투숙객은 38나2207 운전석의 당신 얼굴과 박준호 명찰을 확인했습니다. 자동 기록 오류와 주차칸 오기로는 설명이 안 됩니다.', expect: { kind: 'challenge', target: ['B-02.1', 'B-02.2'], cited: ['E-10', 'E-11'] } },
  { id: 'Q26', person: 'B', extra: B_LATE, text: '번호 인식 오류라면서요. 계기판에 25km가 더 찍혔고, C12 투숙객은 운전석 창을 내린 당신 얼굴과 박준호 명찰을 봤습니다. 이 두 근거는 기록 오류라는 해명과 충돌합니다.', expect: { kind: 'challenge', target: ['B-02.1', 'B-02.2'], cited: ['E-10', 'E-11'] } },
  { id: 'Q31', person: 'C', extra: ['B-02', 'B-03', 'E-12', 'B-F16', 'C-02', 'C-03', 'E-07', 'E-13'], text: '그 잔이 10시 전 잔일 수 없어요. 룸서비스가 22시 45분 쓴 잔 둘을 모두 가져가고 다른 새 잔 둘을 놨어요. 당신 지문은 새 잔에서 나왔으니 첫 방문 흔적이라는 해명은 틀렸습니다.', expect: { kind: 'challenge', target: ['C-03.1', 'C-03.2'], cited: ['E-07'] } },
  { id: 'Q33', person: 'A', blank: true, text: '대표님이 평소 드시던 약은 무엇이었어요? 수면제도 챙겨 드린 적 있나요?', expect: { fact: ['A-F9'], direct: true } },
  { id: 'Q38', person: 'A', blank: true, text: '대표님이 평소 수면제를 드셨습니까?', expect: { fact: ['A-F9'], direct: true } },
  { id: 'Q40', person: 'C', extra: C_ROOM, text: '휴대폰에는 손도 대지 않았다는 말은 감정과 모순이에요. 피해자 휴대폰 화면과 옆면에서 당신 오른손 엄지 지문이 나왔습니다. 왜 만졌어요?', expect: { kind: 'challenge', target: ['C-04.5'], cited: ['E-13'] } },
  { id: 'Q44', person: 'C', extra: [...C_ROOM, 'A-F9'], text: '피해자가 평소 먹던 약이라는 설명은 거짓입니다. 약 포장에서 당신 지문이 나왔고 비서 한서윤은 수면제를 본 적 없다고 직접 말했습니다. 그 약을 가져온 사람은 당신 아닙니까?', expect: { kind: 'challenge', target: ['C-04.3'], cited: ['E-13', 'A-F9'] } },
  { id: 'S01', person: 'B', text: '좋아하는 음식이 뭐예요?', expect: { kind: 'casual' } },
];

interface Usage { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cacheRead?: number; cacheWrite?: number }

/** Claude: 배포된 함수와 같은 서버 코드(server/aiHandler.ts의 runAi)로 부른다. 프롬프트 칸 캐시도 그대로 쓴다 */
async function runClaude(spec: string, user: string): Promise<{ raw: unknown; ms: number; usage: Usage }> {
  const [model] = spec.split(':');
  const s = Date.now();
  const out = await runAi({ task: 'interpret', user }, { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: model });
  const u = out.usage!;
  return { raw: JSON.parse(out.text), ms: Date.now() - s, usage: { promptTokenCount: u.input + u.cacheRead + u.cacheWrite, candidatesTokenCount: u.output, cacheRead: u.cacheRead, cacheWrite: u.cacheWrite } };
}

function config(spec: string) {
  const [model, opt] = spec.split(':');
  const thinking = !opt ? undefined
    : opt.startsWith('t') ? { thinkingBudget: Number(opt.slice(1)) }
    : { thinkingLevel: opt.toUpperCase() };
  return { model, thinking };
}

async function run(spec: string, user: string): Promise<{ raw: unknown; ms: number; usage: Usage }> {
  if (spec.startsWith('claude-')) return runClaude(spec, user);
  const { model, thinking } = config(spec);
  const t = TASKS.interpret; const s = Date.now();
  const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/crime-case-file/locations/global/publishers/google/models/${model}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(40000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: t.system }] }, contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: t.schema, temperature: 0, ...(thinking ? { thinkingConfig: thinking } : {}) },
    }),
  });
  const j = await r.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[]; error?: { message?: string }; usageMetadata?: Usage };
  if (!r.ok) throw new Error(`${r.status} ${j.error?.message ?? ''}`.slice(0, 120));
  const text = j.candidates?.[0]?.content?.parts?.filter((p) => !p.thought).map((p) => p.text ?? '').join('') ?? '{}';
  return { raw: JSON.parse(text), ms: Date.now() - s, usage: j.usageMetadata ?? {} };
}

/** 대화창(src/ui/conversation.ts)과 같은 후처리 */
function postprocess(raw: unknown, c: Case, owned: Set<string>): Interpretation {
  let it = checkDirect(sanitize(raw));
  return keepHandover(ground(it, c.text, c.person), c.text, c.person, owned);
}

function judge(it: Interpretation, e: Expect): boolean {
  const segs = it.segments;
  if (e.kind === 'casual') return segs.some((s) => s.kind === 'casual');
  if (e.kind === 'challenge') {
    return segs.some((s) => s.kind === 'challenge'
      && (!e.target || s.targetClaimIds.some((id) => e.target!.some((t) => id === t || id.startsWith(t + '.'))))
      && (e.cited ?? []).every((id) => s.citedEvidenceIds.includes(id)));
  }
  const qs = segs.filter((s) => s.kind === 'question' && (!e.direct || s.direct !== false));
  if (e.facts) return e.facts.every((id) => qs.some((s) => s.factIds.includes(id)));
  return qs.some((s) => s.factIds.some((id) => e.fact!.includes(id)));
}

const args = process.argv.slice(2);
const flag = (name: string, def: string) => { const i = args.indexOf(name); if (i < 0) return def; const v = args[i + 1]; args.splice(i, 2); return v; };
const runs = Number(flag('--runs', '3'));
const out = flag('--out', '');
const models = args.length ? args : ['gemini-2.5-flash-lite', 'gemini-3.5-flash-lite'];
const report: Record<string, unknown> = {};

for (const spec of models) {
  const rows: { id: string; pass: number; runs: number; ms: number[]; errors: string[]; sample: unknown }[] = [];
  const voice = { cases: 0, usable: 0, samples: [] as string[] };
  const times: number[] = []; const tokens = { prompt: 0, output: 0, thoughts: 0, cacheRead: 0, cacheWrite: 0, n: 0 };
  for (const c of CASES) {
    const owned = new Set<string>([...INITIAL_OWNED, ...(c.blank ? [] : [...BASE, ...FILLED]), ...(c.extra ?? [])]);
    const user = buildUserPrompt({ person: c.person, text: c.text, owned, history: [] });
    const row = { id: c.id, pass: 0, runs: 0, ms: [] as number[], errors: [] as string[], sample: null as unknown };
    for (let k = 0; k < runs; k++) {
      let res;
      for (let i = 0; i < 4 && !res; i++) {
        try { res = await run(spec, user); } catch (e) { row.errors.push(String(e)); await new Promise((r) => setTimeout(r, 2000 * (i + 1))); }
      }
      if (!res) continue;
      row.runs++; row.ms.push(res.ms); times.push(res.ms);
      tokens.prompt += res.usage.promptTokenCount ?? 0; tokens.output += res.usage.candidatesTokenCount ?? 0; tokens.thoughts += res.usage.thoughtsTokenCount ?? 0; tokens.cacheRead += res.usage.cacheRead ?? 0; tokens.cacheWrite += res.usage.cacheWrite ?? 0; tokens.n++;
      const it = postprocess(res.raw, c, owned);
      const ok = judge(it, c.expect);
      if (ok) row.pass++;
      // 해석과 함께 받은 대사: 준비된 답을 고른 질문이면 대사가 있어야 하고, 말투 검사를 통과해야 쓸 수 있다
      if (ok && !c.expect.kind) {
        voice.cases++;
        const r = it.reply;
        const good = r && r.facts.length ? checkVoiced(r.text, r.facts.map((id) => factById.get(id)?.answer ?? ''), c.person, owned, c.text) : null;
        if (good) voice.usable++;
        if (k === 0) voice.samples.push(`${c.id} ${good ? 'OK' : r ? 'NG' : '없음'} [${r?.facts.join(',') ?? ''}] ${r?.text ?? ''}`);
      }
      if (!ok || !row.sample) row.sample = it.segments.map((s) => [s.kind, s.factIds, s.targetClaimIds, s.citedEvidenceIds, s.direct === false ? 'indirect' : '']);
    }
    rows.push(row);
    console.log(`  [${spec}] ${row.pass === row.runs ? '✓' : row.pass ? '△' : '✗'} ${c.id} ${row.pass}/${row.runs} (${row.ms.join(',')}ms)${row.pass < row.runs ? ' → ' + JSON.stringify(row.sample) : ''}`);
  }
  times.sort((a, b) => a - b);
  const q = (p: number) => times[Math.max(0, Math.ceil(times.length * p) - 1)];
  const passed = rows.reduce((a, r) => a + r.pass, 0), total = rows.reduce((a, r) => a + r.runs, 0);
  const summary = {
    accuracy: total ? passed / total : 0, passed, total, casesAllPass: rows.filter((r) => r.runs && r.pass === r.runs).length, cases: rows.length,
    p50: q(0.5), p90: q(0.9), max: times[times.length - 1],
    avgPromptTokens: Math.round(tokens.prompt / Math.max(1, tokens.n)), avgOutputTokens: Math.round(tokens.output / Math.max(1, tokens.n)), avgThoughtTokens: Math.round(tokens.thoughts / Math.max(1, tokens.n)),
    failedAttempts: rows.reduce((a, r) => a + r.errors.length, 0),
    totalTokens: tokens,
    voice: { cases: voice.cases, usable: voice.usable },
  };
  for (const x of voice.samples) console.log('    대사', x);
  report[spec] = { summary, rows };
  console.log(`=== ${spec}: 정확 ${passed}/${total} (${(summary.accuracy * 100).toFixed(0)}%) · 사례 ${summary.casesAllPass}/${rows.length} 전부 통과 · p50 ${summary.p50}ms · p90 ${summary.p90}ms · 최대 ${summary.max}ms · 실패 시도 ${summary.failedAttempts} · 해석 대사 사용 가능 ${voice.usable}/${voice.cases}`);
}
if (out) writeFileSync(out, JSON.stringify(report, null, 2));
