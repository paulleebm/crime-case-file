// 단서·진술 번복 조건 정리 출력 (읽기 전용). 실행: npx tsx scripts/clue-map.ts
import { CHALLENGES, EVIDENCE, FACTS, PERSONS, STATEMENTS } from '../src/data/case';
import { nameOf } from '../src/engine/lookup';

const n = (id: string) => `${id}(${nameOf(id)})`;
console.log('## EVIDENCE');
for (const e of EVIDENCE) {
  const by = FACTS.filter((f) => f.reveals?.includes(e.id)).map((f) => `${f.id}[${f.topic.slice(0, 30)}] cond=${JSON.stringify(f.cond ?? {})}`);
  const ch = CHALLENGES.filter((c) => c.reveals.includes(e.id)).map((c) => c.id);
  console.log(`${e.id} | ${e.title} | ${e.initial ? '처음부터' : [...by, ...ch].join(' ; ') || '?'} | ${(e.summary ?? '').replace(/\s+/g, ' ').slice(0, 110)}`);
}
console.log('## STATEMENTS');
for (const s of STATEMENTS) console.log(`${s.id} | ${PERSONS[s.person].name} | initial=${!!s.initial} | say=${(s.say ?? '').slice(0, 90)}`);
console.log('## CHALLENGES');
for (const c of CHALLENGES) console.log(`${c.id} | ${PERSONS[c.person].name} | targets=${c.targets.join(',')} | lies=${c.lies.join(',')} | requires=${c.requires.map((r) => r.map(n).join('+')).join(' OR ')} | reveals=${c.reveals.join(',')} | closes=${(c.closes ?? []).join(',')}`);
console.log('## FACT REVEALS (statements)');
for (const f of FACTS) if (f.reveals?.some((id) => STATEMENTS.some((s) => s.id === id))) console.log(`${f.id} | ${f.topic.slice(0, 40)} | cond=${JSON.stringify(f.cond ?? {})} | reveals=${f.reveals!.join(',')}`);
