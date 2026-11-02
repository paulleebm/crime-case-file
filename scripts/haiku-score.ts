// 모델 비교 결과(대화 전문·진술서 md)를 같은 기준으로 채점한다. Haiku 보정을 반복할 때 Sonnet과 나란히 본다.
// 실행: npx tsx scripts/haiku-score.ts <md 파일...>   (model-talk-compare.ts / statement-model-compare.ts 결과)
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

type Check = { name: string; ok: boolean };

// ── 대화 전문: 인물·수사팀 턴마다 "> ... · 기록 · 건넴 · 인정 · 조사 시작 · 거절" 줄을 읽는다 ──
function talkTurns(md: string): Record<string, { tags: string; ms: number; reply: string }[]> {
  const out: Record<string, { tags: string; ms: number; reply: string }[]> = {};
  let cur = '';
  let reply = '';
  for (const line of md.split('\n')) {
    const h = line.match(/^## (.+)$/);
    if (h) { cur = h[1].trim(); out[cur] = []; continue; }
    const a = line.match(/^\*\*(?!형사|수사관)(.+?):\*\* (.*)$/);
    if (a) reply = a[2];
    if (cur && line.startsWith('> ')) {
      const ms = Number(line.match(/([\d.]+)초/)?.[1] ?? NaN) * 1000;
      out[cur].push({ tags: line, ms, reply });
      reply = '';
    }
  }
  return out;
}
const ids = (tags: string, k: string) => tags.match(new RegExp(`${k} ([A-Za-z0-9,-]+)`))?.[1].split(',') ?? [];

function scoreTalk(md: string): { checks: Check[]; ms: number[] } {
  const t = talkTurns(md);
  const A = t['류준서'] ?? [], B = t['서민아'] ?? [], C = t['문태준'] ?? [], D = t['수사팀'] ?? [];
  const has = (turn: { tags: string } | undefined, k: string, id: string) => !!turn && ids(turn.tags, k).includes(id);
  const failed = [...A, ...B, ...C, ...D].filter((x) => x.tags.includes('실패')).length;
  const finalRecords = ids(C[5]?.tags ?? '', '기록').filter((id) => ['C-Q04c', 'C-Q11c', 'C-Q16', 'C-Q27', 'C-Q28'].includes(id)).length;
  const admitted = new Set(C.flatMap((x) => ids(x.tags, '인정')));
  const checks: Check[] = [
    { name: '실패 없음', ok: failed === 0 },
    { name: '준서 첫 진술 기록(A-Q01)', ok: has(A[0], '기록', 'A-Q01') },
    { name: '준서 문자 건넴(GT-E05)', ok: has(A[2], '건넴', 'GT-E05') },
    { name: '민아 메시지 건넴(GT-E08)', ok: has(B[3], '건넴', 'GT-E08') },
    { name: '민아 인정 없음(정직한 증인)', ok: B.every((x) => !ids(x.tags, '인정').length) },
    { name: '태준 GT-E13에서 돈 문제 인정(C-R01)', ok: has(C[2], '인정', 'C-R01') },
    { name: '태준 지문만으로는 버팀', ok: !ids(C[3]?.tags ?? '', '인정').length },
    { name: '태준 예약 문자 증거에서 범행 인정(C-R03·C-R04)', ok: has(C[4], '인정', 'C-R03') && has(C[4], '인정', 'C-R04') },
    { name: '태준 퇴실 시각 정정 인정(C-R02, 5~6턴)', ok: has(C[4], '인정', 'C-R02') || has(C[5], '인정', 'C-R02') },
    { name: '태준 네 단계 모두 인정', ok: ['C-R01', 'C-R02', 'C-R03', 'C-R04'].every((id) => admitted.has(id)) },
    { name: '자백 뒤 경위 기록 3개 이상', ok: finalRecords >= 3 },
    { name: '수사팀 통화 조회(GT-R03)', ok: has(D[0], '조사 시작', 'GT-R03') },
    { name: '수사팀 권한 문자 조회 수락(GT-R35)', ok: has(D[1], '조사 시작', 'GT-R35') },
    { name: '수사팀 CCTV 거절(D-cctv)', ok: has(D[2], '거절', 'D-cctv') },
    { name: '수사팀 태준 휴대폰(GT-R27)', ok: has(D[3], '조사 시작', 'GT-R27') },
    { name: '수사팀 범인 질문에 조사 시작 없음', ok: !ids(D[4]?.tags ?? '', '조사 시작').length },
    { name: '수사팀 부검 결과 질문에 사인 감정 시작(GT-R01)', ok: has(D[5], '조사 시작', 'GT-R01') },
  ];
  return { checks, ms: [...A, ...B, ...C, ...D].map((x) => x.ms).filter((x) => !Number.isNaN(x)) };
}

// ── 진술서: "### 인물" 아래 "**항목**"과 "- 문장 _(kind: 앞서 "…")_" 줄을 읽는다 ──
function scoreStatement(md: string, dialogue: string): { checks: Check[]; ms: number[] } {
  const persons: Record<string, { section: string; text: string; kind: string; was: string }[]> = {};
  let cur = '', sec = '';
  const ms: number[] = [];
  for (const line of md.split('\n')) {
    const h = line.match(/^### (.+)$/);
    if (h) { cur = h[1].trim(); persons[cur] = []; continue; }
    if (line.startsWith('> ') && cur) for (const m of line.matchAll(/([\d.]+)초/g)) ms.push(Number(m[1]) * 1000);
    const s = line.match(/^\*\*(.+)\*\*$/);
    if (s) { sec = s[1]; continue; }
    const l = line.match(/^- (.*?)(?: _\((\w+)(?:: 앞서 "(.*)")?\)_)?$/);
    if (l && cur) persons[cur].push({ section: sec, text: l[1], kind: l[2] ?? 'claim', was: l[3] ?? '' });
  }
  const C = persons['문태준'] ?? [], B = persons['서민아'] ?? [], all = Object.values(persons).flat();
  const revised = C.filter((x) => x.kind === 'revised');
  const norm = (x: string) => x.replace(/[\s.,…"“”'‘’~요다니습어]/g, '');
  const said = norm(dialogue);
  // 앞서 한 말(was)의 핵심 낱말이 대화에 없으면 지어낸 것으로 본다
  const invented = revised.filter((x) => { const words = x.was.split(/\s+/).filter((w) => w.length >= 2); const hit = words.filter((w) => said.includes(norm(w))).length; return words.length && hit / words.length < 0.6; });
  const checks: Check[] = [
    { name: '진술서 세 사람 모두 있음', ok: ['류준서', '서민아', '문태준'].every((p) => (persons[p] ?? []).length > 0) },
    { name: '태준 정정: 정기 보고 → 돈 문제', ok: revised.some((x) => /정기|보고/.test(x.was) && /돈|운영비|계좌/.test(x.text)) },
    { name: '태준 정정: 8시 45분 → 8시 50분', ok: revised.some((x) => /45/.test(x.was) && /50/.test(x.text)) },
    { name: '없는 말을 "앞서 한 말"로 지어내지 않음', ok: invented.length === 0 },
    { name: '같은 말을 정정으로 표시하지 않음', ok: revised.every((x) => norm(x.was) !== norm(x.text)) },
    { name: '민아(정직한 증인) "진술" 표시 3줄 이하', ok: B.filter((x) => x.kind === 'added').length <= 3 },
    { name: '소명 요청 문자 문장을 "마지막 문자"에 넣지 않음', ok: !C.some((x) => /마지막 문자/.test(x.section) && /받은 것/.test(x.text)) },
    { name: '오전/오후로 시각을 바꾸지 않음', ok: !all.some((x) => /오전/.test(x.text)) },
  ];
  return { checks, ms };
}

const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };
for (const f of process.argv.slice(2)) {
  const md = readFileSync(f, 'utf8');
  const isStatement = md.startsWith('# 진술서');
  const dialogue = isStatement ? readFileSync(md.match(/대화: `(.+?)`/)![1], 'utf8') : '';
  const { checks, ms } = isStatement ? scoreStatement(md, dialogue) : scoreTalk(md);
  const pass = checks.filter((c) => c.ok).length;
  const cost = md.match(/비용 약 \$([\d.]+)/)?.[1];
  console.log(`${basename(f)}  ${pass}/${checks.length}  중앙값 ${(pct(ms, 0.5) / 1000).toFixed(1)}초 · 90% ${(pct(ms, 0.9) / 1000).toFixed(1)}초 · 최대 ${(Math.max(...ms) / 1000).toFixed(1)}초${cost ? ` · $${cost}` : ''}`);
  for (const c of checks) if (!c.ok) console.log(`   ✗ ${c.name}`);
}
