// 인물 설정집(src/data/bible.ts)을 사람이 읽기 좋은 문서로 옮긴다. 실행: npx tsx scripts/bible-doc.ts
import fs from 'node:fs';
import { PERSONS } from '../src/data/case';
import { BIBLE } from '../src/data/bible';
import type { Cond, PersonId } from '../src/data/types';

const cond = (c?: Cond) => (c ? [c.all?.length ? `모두: ${c.all.join(', ')}` : '', c.any?.length ? `하나라도: ${c.any.join(', ')}` : ''].filter(Boolean).join(' / ') : '');
const lines: string[] = [
  '# 인물 설정집',
  '',
  'AI가 인물의 말을 지을 때 읽는 자료다. 원본은 `src/data/bible.ts`이고, 이 문서는 `npx tsx scripts/bible-doc.ts`로 만든다.',
  '',
  '- **공통 설정**: 늘 보이는 성격·말투·배경·관계.',
  '- **단계별 입장**: 받아 낸 진술(정정 진술 ID)에 따라 켜지고 꺼진다. 그 단계에서 인물이 하는 이야기(거짓말 포함)만 적는다. 아직 인정하지 않은 진실은 적지 않아 AI가 볼 수 없다.',
  '- **금지 표현**: 그 블록이 켜져 있는 동안 지은 말에 나오면 그 말을 버리고 정해 둔 말을 쓴다.',
  '',
  '무엇을 말할지는 엔진(답변 데이터·지적 규칙)이 정하고, 어떻게 말할지는 AI가 이 설정집과 대화 흐름을 보고 정한다.',
  '',
];
for (const p of Object.keys(BIBLE) as PersonId[]) {
  lines.push(`## ${PERSONS[p].name}`, '', '### 공통 설정', '', BIBLE[p].core, '');
  for (const b of BIBLE[p].blocks) {
    const when = [b.cond ? `켜짐 — ${cond(b.cond)}` : '처음부터', b.until ? `꺼짐 — ${cond(b.until)}` : ''].filter(Boolean).join(' · ');
    lines.push(`### ${b.id}`, '', `*${when}*`, '', b.text, '');
    if (b.never?.length) lines.push(`금지 표현: ${b.never.map((w) => `\`${w}\``).join(', ')}`, '');
  }
}
fs.writeFileSync('design/character-bible.md', lines.join('\n'));
console.log('design/character-bible.md 작성');
