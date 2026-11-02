// 작업별 프롬프트 토큰 프로필 (Claude 토큰 계산 API, 요금 없음). 실행: npx tsx scripts/token-profile.ts
import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync } from 'node:fs';
import { INITIAL_OWNED, PERSONS } from '../src/data/case';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import type { PersonId } from '../src/data/types';
import { TASKS, type AiTask } from '../src/ai/prompts';
import { buildUserPrompt, situationSheet } from '../src/ai/interpret';
import { bibleSheet, buildVoicePrompt } from '../src/ai/voice';
import { allowedFacts } from '../src/engine/logic';
import { plain } from '../src/data/clues';

if (!process.env.ANTHROPIC_API_KEY && existsSync('.env.local')) {
  const m = readFileSync('.env.local', 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m);
  if (m) process.env.ANTHROPIC_API_KEY = m[1].trim();
}
const client = new Anthropic();
const count = async (text: string) => (await client.messages.countTokens({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: text || '.' }] })).input_tokens;

const FILLED = Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => s.paras.map((p) => p.by[0])));
const STATES: Record<string, string[]> = {
  early: [...INITIAL_OWNED],
  mid: [...INITIAL_OWNED, 'A-01', 'B-01', 'C-01', ...FILLED, 'E-16', 'B-02', 'E-06', 'E-10', 'E-11'],
  late: [...INITIAL_OWNED, 'A-01', 'B-01', 'C-01', ...FILLED, 'E-16', 'A-02', 'B-02', 'B-03', 'E-06', 'E-10', 'E-11', 'E-12', 'B-F16', 'C-02', 'C-03', 'C-04', 'E-07', 'E-13', 'E-15'],
};
const memo = '· 인정한 것: 아직 처음 진술에서 바꾼 것이 없다\n· 이미 한 말: [발견 경위] 12시 반쯤 자료를 들고 올라갔어요… | [행적] 10시 15분에 객실을 나와서…\n· 최근 화제: 발견 경위';
const history = Array.from({ length: 6 }, (_, i) => ({ id: String(i), role: (i % 2 ? 'them' : 'me') as 'me' | 'them', text: i % 2 ? '10시 15분에 객실을 나와서 1층 비즈니스 센터에서 자료를 정리했어요. 11시 반하고 자정에 대표님께 전화를 드렸는데 받지 않으셨어요.' : '그 뒤에는 어디 계셨어요? 혹시 누구를 보셨나요?' }));

console.log('system', Object.fromEntries(await Promise.all((Object.keys(TASKS) as AiTask[]).map(async (t) => [t, await count(TASKS[t].system)]))));
for (const [name, ids] of Object.entries(STATES)) for (const person of ['A', 'C'] as PersonId[]) {
  const owned = new Set(ids);
  const full = buildUserPrompt({ person, text: '그날 밤 몇 시에 어디 계셨어요?', owned, history, memo });
  const parts = full.split(/\n(?=\[)/);
  const sec: Record<string, number> = {};
  for (const p of parts) sec[p.slice(0, p.indexOf(']') + 1)] = await count(p);
  const sheet = situationSheet(person, owned), bible = bibleSheet(person, owned);
  const examples = allowedFacts(person, owned).filter((f) => f.id.includes('-D') || f.id.includes('-F')).slice(0, 8).map((f) => `- ${plain(f.answer)}`).join('\n');
  const voice = buildVoicePrompt({ person, question: '그날 밤 몇 시에 어디 계셨어요?', points: [allowedFacts(person, owned)[0].answer], situation: 'answer', owned, history, memo });
  console.log(`${name} ${person}`, JSON.stringify({ interpret: await count(full), sections: sec, write: { situation: await count(sheet), bible: await count(bible), examples: await count(examples), total: (await count(sheet)) + (await count(bible)) + (await count(examples)) + 400 }, voice: await count(voice), facts: allowedFacts(person, owned).length, name: PERSONS[person].name }));
}
