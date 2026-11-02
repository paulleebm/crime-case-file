// 플레이 저장본의 자료 획득 순서를 따라가며, 인물별 캐시 칸이 몇 번 바뀌는지 센다 (API 호출 없음).
// 실행: npx tsx scripts/cache-churn.ts [저장본.json]
import { readFileSync } from 'node:fs';
import { INITIAL_OWNED } from '../src/data/case';
import type { PersonId } from '../src/data/types';
import { buildUserPrompt } from '../src/ai/interpret';
import { promptParts } from '../src/ai/prompts';

const save = JSON.parse(readFileSync(process.argv[2] ?? 'design/playtest-2026-10-13-fourth/game-save.json', 'utf8'));
const order: string[] = save.owned.filter((id: string) => !INITIAL_OWNED.includes(id));
for (const person of ['A', 'B', 'C'] as PersonId[]) {
  const seen = [new Set<string>(), new Set<string>()];
  let changes = [0, 0], prev = ['', ''], chars = 0;
  for (let i = 0; i <= order.length; i++) {
    const owned = new Set([...INITIAL_OWNED, ...order.slice(0, i)]);
    const parts = promptParts(buildUserPrompt({ person, text: 'x', owned, history: [] }));
    for (const k of [0, 1]) { if (parts[k] !== prev[k]) { changes[k]++; prev[k] = parts[k]; } seen[k].add(parts[k]); }
    chars = Math.max(chars, parts[0].length);
  }
  console.log(person, `획득 ${order.length}건 동안 인물 칸 ${changes[0]}번 바뀜(서로 다른 ${seen[0].size}개, 최대 ${chars}자) · 진행 칸 ${changes[1]}번`);
}
