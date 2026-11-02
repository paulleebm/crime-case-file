// 근거 지도: 모든 자료·진술의 근거 문장 번호와, 어떤 거짓말을 어떤 근거로 깨는지 게임 흐름 순서로 정리한다.
// 게임 데이터에서 그대로 만든다. 실행: npx tsx scripts/evidence-map.ts  →  design/evidence-map.md
import fs from 'node:fs';
import { CHALLENGES, EVIDENCE, EVIDENCE_TREE, FACTS, INITIAL_OWNED, PERSONS, REPORT_QUESTIONS, STATEMENTS } from '../src/data/case';
import { clueRe, plain } from '../src/data/clues';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import type { Block, Challenge, PersonId } from '../src/data/types';

const MAIN = ['X-A1', 'X-B1', 'X-C1', 'X-C3', 'X-C4'];
const SIDE = ['X-C2', 'X-C4a', 'X-C4b', 'X-C4c', 'X-B0', 'X-C0', 'X-C5'];
const ch = (id: string) => CHALLENGES.find((c) => c.id === id)!;
const clip = (t: string, n = 90) => { const x = plain(t).replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };
const esc = (t: string) => t.replace(/\|/g, '｜');

// 근거 문장 ID → 글
const TEXT = new Map<string, string>();
const blockTexts = (b: Block): string[] => b.type === 'p' || b.type === 'h' ? [b.text] : b.type === 'table' ? b.rows.flat() : b.type === 'log' ? b.lines : b.type === 'cuts' ? b.cuts.map((c) => c.text) : [];
const take = (t: string) => { for (const m of t.matchAll(clueRe())) TEXT.set(m[1], m[2]); };
EVIDENCE.forEach((e) => e.body.flatMap(blockTexts).forEach(take));
Object.values(STATEMENT_FORMS).forEach((f) => f.sections.forEach((s) => s.paras.forEach((p) => take(p.text))));
STATEMENTS.forEach((s) => take(s.text));
FACTS.forEach((f) => take(f.answer));
const textOf = (id: string) => { const st = STATEMENTS.find((s) => s.id === id); return TEXT.get(id) ?? (FACTS.find((f) => f.id === id) ? plain(FACTS.find((f) => f.id === id)!.answer) : st ? st.say ?? plain(st.text) : ''); };
const docOf = (id: string) => EVIDENCE.find((e) => id === e.id || id.startsWith(e.id + '.'));
const label = (id: string) => {
  const d = docOf(id);
  if (d) return `**${id}** ${d.title}`;
  const p = id[0] as PersonId;
  return `**${id}** ${PERSONS[p]?.name ?? ''}${FACTS.some((f) => f.id === id) ? '의 답' : '의 진술'}`;
};
const quote = (id: string, n = 80) => `“${esc(clip(textOf(id), n))}”`;

// 진술서 문장을 채우는 질문(답)
const askFor = (lie: string): string | null => {
  for (const f of Object.values(STATEMENT_FORMS)) for (const s of f.sections) for (const p of s.paras) if (p.text.includes(`⟦${lie}|`)) {
    const fact = FACTS.find((x) => x.id === p.by[0]);
    return fact ? `질문: ${fact.topic.split(',')[0]} (${p.by[0]})` : null;
  }
  const f = FACTS.find((x) => x.id === lie);
  if (f) return `질문: ${f.topic.split(',')[0]}`;
  return null;
};
// 이 문장을 처음 내놓는 지적
const revealedBy = (statementId: string) => CHALLENGES.find((c) => c.reveals.includes(statementId));
const sourceOfLie = (lie: string) => {
  const st = lie.replace(/\.\d+$/, '');
  const from = STATEMENTS.find((s) => s.id === st);
  if (from && !from.initial) { const c = revealedBy(st); return c ? `${c.id} 정정에서 생기는 말` : '정정에서 생기는 말'; }
  return askFor(lie) ?? '-';
};

// 근거 → 쓰이는 곳
const uses = new Map<string, string[]>();
for (const c of CHALLENGES) {
  for (const set of c.requires) for (const id of set) uses.set(id, [...(uses.get(id) ?? []), set.length > 1 ? `${c.id}(함께: ${set.filter((x) => x !== id).join('+')})` : c.id]);
  for (const p of c.partial ?? []) for (const id of p.has) if (!c.requires.flat().includes(id)) uses.set(id, [...(uses.get(id) ?? []), `${c.id}(부분 반박만)`]);
}
// 진술서 문장(A-01.9)은 그 문단을 채운 답(A-F9)의 쓰임을 이어받는다
const formFacts = new Map<string, string[]>();
Object.values(STATEMENT_FORMS).forEach((f) => f.sections.forEach((s) => s.paras.forEach((p) => { for (const m of p.text.matchAll(clueRe())) formFacts.set(m[1], p.by); })));
const usesOf = (id: string) => [...new Set([...(uses.get(id) ?? []), ...(uses.get(id.replace(/\.\d+$/, '')) ?? []).filter(() => !docOf(id)), ...(formFacts.get(id) ?? []).flatMap((f) => uses.get(f) ?? [])])];
const lieOf = (id: string) => CHALLENGES.filter((c) => c.lies.includes(id)).map((c) => c.id);

const out: string[] = [];
const w = (s = '') => out.push(s);

w('# 근거 지도 — 호텔 벨루아 2307호');
w();
w('> 게임 데이터에서 자동으로 만든 문서다. 데이터를 고친 뒤 `npx tsx scripts/evidence-map.ts`로 다시 만든다.');
w();
w('## 읽는 법');
w();
w('- **근거 번호**: 자료의 밑줄 문장은 `E-06.2`처럼 자료 번호 뒤에 줄 번호가 붙는다. 진술서와 정정 진술의 문장은 `B-03.3`, 대화로 받은 답은 `A-F9`처럼 답 하나가 단위다.');
w('- **근거 제시**: 근거를 붙여 내밀면, 그 근거가 깨는 이 사람의 숨긴 이야기를 찾아 판정한다. 어느 말인지 고르지 않는다. 여러 이야기가 맞으면 더 깊은 인정을 고른다. 근거는 문장 단위로만 통한다.');
w('- **거짓말 전 제시**: 아래 “맞댈 말”을 아직 듣기 전에 근거를 내밀면, 거짓말 없이 바로 털어놓는다(정정이 아니라 새 진술).');
w('- **새 자료**는 거짓말을 깼을 때만 나온다.');
w('- 근거 칸의 “또는”은 그중 하나만 붙여도 된다는 뜻이고, “+”는 함께 붙여야 한다는 뜻이다.');
w();

// 1. 흐름
w('## 1. 논파 흐름 (플레이 순서)');
w();
const row = (c: Challenge, n: string) => {
  const lies = c.lies.filter((l) => /\.\d/.test(l) || FACTS.find((f) => f.id === l)?.record);
  const main = lies.slice(0, 3);
  const req = c.requires.map((set) => set.map((id) => `${id} ${quote(id, 40)}`).join(' + ')).join('<br>또는 ');
  const st = c.reveals.find((id) => STATEMENTS.some((s) => s.id === id))!;
  const docs = c.reveals.filter((id) => docOf(id) && id.startsWith('E-')).map((id) => `**${id} ${docOf(id)!.title}**`);
  w(`| ${n} | ${PERSONS[c.person].name} | ${main.map((l) => `${l} ${quote(l, 45)}`).join('<br>')} | ${esc(sourceOfLie(main[0]))} | ${req} | ${st} ${quote(st, 60)} | ${docs.join('<br>') || '—'} |`);
};
w('### 본 줄기');
w();
w('| 순서 | 상대 | 맞댈 말 (거짓말) | 그 말이 생기는 때 | 맞댈 근거 | 정정 | 새 자료 |');
w('|---|---|---|---|---|---|---|');
MAIN.forEach((id, i) => row(ch(id), `${i + 1}`));
w();
w('### 곁가지');
w();
w('| 지적 | 상대 | 맞댈 말 (거짓말) | 그 말이 생기는 때 | 맞댈 근거 | 정정 | 새 자료 |');
w('|---|---|---|---|---|---|---|');
SIDE.forEach((id) => row(ch(id), id));
w();
w('### 일부만 맞을 때 버티는 말');
w();
for (const c of CHALLENGES) for (const p of c.partial ?? []) w(`- **${c.id}** ${p.has.join(' + ')}만 붙이면: “${esc(clip(p.reply, 70))}”${p.feedback ? ` → 수첩: ${esc(clip(p.feedback, 90))}` : ''}`);
w();

// 2. 자료
w('## 2. 자료별 근거 문장');
w();
const revealedDocs = MAIN.concat(SIDE).flatMap((id) => ch(id).reveals.filter((x) => x.startsWith('E-')));
const order = [...EVIDENCE_TREE.flatMap((g) => g.items).filter((id) => INITIAL_OWNED.includes(id)), ...revealedDocs];
for (const id of [...new Set(order)]) {
  const e = EVIDENCE.find((x) => x.id === id);
  if (!e) continue;
  const from = e.initial ? '처음부터' : `${CHALLENGES.find((c) => c.reveals.includes(id))!.id} 논파로 나옴`;
  w(`### ${id} ${e.title} — ${from}`);
  w();
  const ids = [...new Set(e.body.flatMap(blockTexts).flatMap((t) => [...t.matchAll(clueRe())].map((m) => m[1])))];
  if (!ids.length) { w('(밑줄 문장 없음)'); w(); continue; }
  w('| 번호 | 문장 | 깨는 거짓말 |');
  w('|---|---|---|');
  for (const cid of ids) w(`| ${cid} | ${esc(clip(TEXT.get(cid)!, 110))} | ${usesOf(cid).join(', ') || '— (배경)'} |`);
  w();
}

// 3. 인물별 진술
w('## 3. 인물별 진술 문장');
w();
for (const p of ['A', 'B', 'C'] as PersonId[]) {
  w(`### ${PERSONS[p].name}`);
  w();
  w('| 번호 | 문장 | 언제 생기나 | 거짓말이면 깨는 지적 | 근거로 쓰이는 곳 |');
  w('|---|---|---|---|---|');
  const rows: string[] = [];
  for (const s of STATEMENT_FORMS[p].sections) for (const para of s.paras) for (const m of para.text.matchAll(clueRe())) rows.push(m[1]);
  for (const s of STATEMENTS.filter((x) => x.person === p && !x.initial)) for (const m of s.text.matchAll(clueRe())) rows.push(m[1]);
  for (const f of FACTS.filter((x) => x.person === p && (CHALLENGES.some((c) => c.lies.includes(x.id) || c.requires.flat().includes(x.id))))) rows.push(f.id);
  for (const id of [...new Set(rows)]) {
    const lies = lieOf(id);
    const breaks = lies.map((cid) => `${cid}: ${ch(cid).requires.map((set) => set.join('+')).join(' 또는 ')}`).join('<br>');
    w(`| ${id} | ${esc(clip(textOf(id), 80))} | ${esc(sourceOfLie(id))} | ${breaks || '— (사실)'} | ${usesOf(id).join(', ') || '—'} |`);
  }
  w();
}

// 4. 사건 재구성
w('## 4. 사건 재구성 문항과 답의 출처');
w();
w('| 문항 | 모범 답 | 채점 요점 (필요 개수) | 어디서 알 수 있나 |');
w('|---|---|---|---|');
w(`| 누가: 범인 (선택형) | ${PERSONS.C.name} | — | 본 줄기 전체 |`);
for (const q of REPORT_QUESTIONS) w(`| ${q.w}: ${esc(q.q)} | ${esc(q.model)} | ${q.points.map((p) => esc(p.text)).join('<br>')} (${q.need}개) | ${esc(q.source)} |`);
w();

fs.writeFileSync('design/evidence-map.md', out.join('\n'));
console.log('design/evidence-map.md', out.length, 'lines');
