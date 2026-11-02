// 인물 목소리 품질 평가. 실제 엔진으로 장면을 만들고, 실제 Vertex AI(gemini)로 말을 지은 뒤 검사 통과 여부와 결과를 나란히 보여 준다.
// 실행: npx tsx scripts/voice-eval.ts [반복 횟수]   (gcloud 로그인 필요, crime-case-file 프로젝트에 요금이 조금 든다)
import { execSync } from 'node:child_process';
import { INITIAL_OWNED } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import type { PersonId } from '../src/data/types';
import { TASKS } from '../src/ai/prompts';
import { buildVoicePrompt, checkVoiced, type VoiceSituation } from '../src/ai/voice';
import { resolve, type Segment } from '../src/engine/logic';
import { CONFESSION } from '../src/data/case';

const PROJECT = 'crime-case-file';
const MODEL = process.env.VOICE_MODEL || 'gemini-2.5-flash-lite';
const token = execSync('gcloud auth print-access-token', { encoding: 'utf8' }).trim();

const BASE = ['A-01', 'B-01', 'C-01'];
const FILLED = Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => s.paras.map((p) => p.by[0])));
const q = (...factIds: string[]): Segment => ({ kind: 'question', targetClaimIds: [], citedEvidenceIds: [], factIds });
const ch = (t: string, ev: string[]): Segment => ({ kind: 'challenge', targetClaimIds: [t], citedEvidenceIds: ev, factIds: [] });

interface Scene { person: PersonId; extra: string[]; question: string; segs: Segment[] }
const C4 = ['C-02', 'C-04', 'E-12', 'E-13', 'E-15', 'E-17'];
const SCENES: Scene[] = [
  { person: 'A', extra: [], question: '사건 당시 알리바이 있으세요?', segs: [q('A-D01')] },
  { person: 'A', extra: [], question: '대표님이랑 오늘 다투신 적 있어요?', segs: [q('A-F2')] },
  { person: 'A', extra: [], question: '발견하셨을 때 상황을 처음부터 말씀해 주세요.', segs: [q('A-F8'), q('A-F20')] },
  { person: 'A', extra: [], question: '대표님이 평소에 수면제 드셨나요?', segs: [q('A-F9')] },
  { person: 'A', extra: ['A-02'], question: '서명하라던 그 서류가 정확히 뭐였어요? 사본도 볼 수 있을까요?', segs: [q('A-F12')] },
  { person: 'A', extra: [], question: '업무 얘기뿐이었다고요? 연회 직원이 서명 하나 못 하냐는 고함을 들었어요.', segs: [ch('A-01.1', ['E-16'])] },
  { person: 'B', extra: [], question: '그 차, 맡은 뒤에 한 번이라도 움직였어요?', segs: [q('B-F5')] },
  { person: 'B', extra: [], question: '밤 10시 이후엔 어디서 뭐 하셨어요?', segs: [q('B-F6')] },
  { person: 'B', extra: [], question: '한 번도 안 움직였다고요? 출입 기록엔 11시에 나가서 11시 40분에 들어왔는데요.', segs: [ch('B-01.4', ['E-06'])] },
  { person: 'B', extra: ['B-02', 'B-03', 'E-10', 'E-11', 'E-12'], question: '도대체 왜 손님 차를 몰고 나간 거예요?', segs: [q('B-F17')] },
  { person: 'B', extra: ['B-02', 'B-03', 'E-10', 'E-11', 'E-12'], question: '지하에서 누굴 봤다는 거예요? 자세히요.', segs: [q('B-F16')] },
  { person: 'C', extra: [], question: '10시 반에 나가신 뒤엔 뭐 하셨습니까?', segs: [q('C-F5')] },
  { person: 'C', extra: [], question: '장 대표님과 돈 문제로 갈등 있으셨죠?', segs: [q('C-F7')] },
  { person: 'C', extra: [], question: '휴대폰에 남은 그 유서, 어떻게 보세요?', segs: [q('C-F14')] },
  { person: 'C', extra: [], question: '돌아오지 않았다고요? 프런트 근무일지에 그 뒤로 이름이 없던데요.', segs: [ch('C-01.4', ['E-05'])] },
  { person: 'C', extra: C4, question: '장 대표 휴대폰 만지셨어요?', segs: [q('C-F28')] },
  { person: 'C', extra: C4, question: '손도 안 댔다고요? 휴대폰 화면에서 당신 엄지 지문이 나왔습니다.', segs: [ch('C-04.5', ['E-13'])] },
  { person: 'C', extra: [...C4, 'C-07'], question: '그 초안이란 게 뭡니까?', segs: [q('C-F14c')] },
  { person: 'C', extra: [...C4], question: '방에 가서 뭘 했습니까?', segs: [q('C-D11')] },
  { person: 'A', extra: [], question: '대표님 차 번호 기억나세요?', segs: [q()] },
  { person: 'B', extra: [], question: '그 손님이 무슨 향수 쓰는지 알아요?', segs: [q()] },
  { person: 'C', extra: [], question: '그 시각 반포 둔치에 다른 차들도 많았습니까?', segs: [q()] },
  { person: 'B', extra: [], question: '어, 그러니까 그거 말이에요 그거.', segs: [{ kind: 'clarify', targetClaimIds: [], citedEvidenceIds: [], factIds: [] }] },
];

async function voice(user: string): Promise<{ text: string; ms: number }> {
  const t = TASKS.voice;
  const started = Date.now();
  const r = await fetch(`https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(45000),
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: t.system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { responseMimeType: 'application/json', responseJsonSchema: t.schema, temperature: t.temperature, ...(MODEL.includes('lite') ? {} : { thinkingConfig: { thinkingLevel: 'LOW' } }) },
    }),
  });
  const j = await r.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message ?? String(r.status));
  return { text: j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '', ms: Date.now() - started };
}

const runs = Number(process.argv[2] ?? 1);
let pass = 0, total = 0;
const times: number[] = [];
for (const s of SCENES) {
  // 실제처럼: 지금 묻는 주제의 답은 아직 듣지 않은 상태로 둔다
  const asked = new Set(s.segs.flatMap((g) => g.factIds));
  const owned = new Set<string>([...INITIAL_OWNED, ...BASE, ...FILLED.filter((id) => !asked.has(id)), ...s.extra]);
  const out = resolve(s.person, { segments: s.segs, confidence: 1 }, [], owned, new Set(), [], {}, [], s.question);
  const situation: VoiceSituation | null = out.kind === 'fact' ? 'answer' : out.kind === 'success' ? 'admit' : ['nearMiss', 'irrelevant', 'repeat'].includes(out.kind) ? 'resist' : out.kind === 'unknown' ? 'unknown' : out.kind === 'clarify' ? 'clarify' : null;
  const points = out.parts.map((p) => p.text);
  console.log(`\n■ ${s.person} [${out.kind}${out.record ? ' ' + out.record : ''}] 형사: ${s.question}`);
  console.log(`  정해 둔 말: ${points.join(' / ').replace(/⟦[^|]+\|([^⟧]+)⟧/g, '$1')}`);
  if (!situation || out.record === CONFESSION) { console.log('  (목소리 대상 아님)'); continue; }
  const user = buildVoicePrompt({ person: s.person, question: s.question, points, situation, owned, history: [] });
  for (let i = 0; i < runs; i++) {
    total++;
    try {
      const { text, ms } = await voice(user);
      times.push(ms);
      const reply = (JSON.parse(text) as { reply: string }).reply;
      const ok = checkVoiced(reply, points, s.person, owned, s.question);
      if (ok) pass++;
      console.log(`  ${ok ? '✓' : '✗'} (${ms}ms) ${reply}`);
    } catch (e) {
      console.log(`  ! 오류 ${e instanceof Error ? e.message : e}`);
    }
  }
}
times.sort((a, b) => a - b);
console.log(`\n검사 통과 ${pass}/${total} (${Math.round((pass / Math.max(1, total)) * 100)}%) · 응답 p50 ${times[Math.floor(times.length / 2)]}ms · p90 ${times[Math.floor(times.length * 0.9)]}ms`);
