// 서버 경로(runAi)로 답 쓰기·말투·잡담을 두 번씩 불러 응답 형식과 캐시 적중을 확인한다. 실행: npx tsx scripts/claude-smoke.ts
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import { runAi } from '../server/aiHandler';
import { buildVoicePrompt } from '../src/ai/voice';
import { CACHE_BREAK } from '../src/ai/prompts';
import { bibleSheet } from '../src/ai/voice';
import { situationSheet } from '../src/ai/interpret';
import { PERSONS } from '../src/data/case';
import { toneOf } from '../src/data/tone';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const env = { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, ANTHROPIC_MODEL: 'claude-sonnet-5-5' };
const FILLED = Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => s.paras.map((p) => p.by[0])));
const owned = new Set([...INITIAL_OWNED, 'A-01', 'B-01', 'C-01', ...FILLED]);
const p = PERSONS.A, tone = toneOf('A', owned);
const writeUser = (q: string) => [`[인물] ${p.name} (${p.age}세, ${p.role})`, `[말투] ${tone.voice}`, `[태도] ${tone.demeanor}`, `[프로필] ${p.profile}`, '', '[인물 설정과 지금 입장]', bibleSheet('A', owned), '', '[상황 설정]', situationSheet('A', owned), CACHE_BREAK, '[상황 메모]\n(없음)', '[최근 대화]\n(없음)', '', '<형사의 말>', q, '</형사의 말>'].join('\n');
const voiceUser = (q: string) => buildVoicePrompt({ person: 'A', question: q, points: ['10시 15분에 객실을 나와서 1층 비즈니스 센터에서 자료를 정리했어요.'], situation: 'answer', owned, history: [] });
for (const [task, user] of [['write', writeUser('그때 비즈니스 센터에 다른 사람도 있었어요?')], ['write', writeUser('센터에서 나온 적은 없어요?')], ['voice', voiceUser('그 뒤엔 어디 계셨어요?')], ['voice', voiceUser('10시 반쯤엔 뭐 하셨어요?')], ['casual', '[인물] 한서윤\n<형사의 말>\n커피 좋아하세요?\n</형사의 말>']] as const) {
  const out = await runAi({ task, user }, env);
  console.log(task, out.ms + 'ms', JSON.stringify(out.usage), out.text.slice(0, 120));
}
