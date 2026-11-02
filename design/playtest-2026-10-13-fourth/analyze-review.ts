import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkVoiced } from '../../src/ai/voice';
import { STATEMENTS } from '../../src/data/case';
import { matchRequest } from '../../src/engine/requests';

const dir = fileURLToPath(new URL('.', import.meta.url));
const read = (name: string) => JSON.parse(readFileSync(dir + name, 'utf8'));
const raw = read('latency-raw.json');
const browser = read('browser-observations.json');
const save = read('game-save.json');
const allStats = new Map<string, any>();
for (const ask of browser.asks) {
  const t = ask.timing.result ? JSON.parse(ask.timing.result.value) : ask.timing;
  for (const s of t.ai.recent) allStats.set(`${s.at}:${s.task}:${s.route}:${s.ms}`, s);
}
for (const s of raw.stats.recent) allStats.set(`${s.at}:${s.task}:${s.route}:${s.ms}`, s);
const stats = [...allStats.values()].sort((a, b) => a.at - b.at);
const quantile = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(xs.length * p) - 1)];
const summarize = (xs: number[]) => ({ n: xs.length, meanMs: xs.reduce((a, b) => a + b, 0) / xs.length, p50Ms: quantile(xs, .5), p90Ms: quantile(xs, .9), minMs: Math.min(...xs), maxMs: Math.max(...xs), totalMs: xs.reduce((a, b) => a + b, 0), over5s: xs.filter(x => x > 5000).length, over8s: xs.filter(x => x > 8000).length });
const nonAi = new Set([20, 21, 25]);
const auxiliary = new Set([3, 37, 45]);
const rows = raw.entries.map((e: any, i: number) => {
  const n = i + 1;
  const ask = browser.asks.find((a: any) => a.id === `Q${String(n).padStart(2, '0')}`);
  let person = '', response = '', kind = '', facts: string[] = [];
  for (const [p, ms] of Object.entries(save.chats) as [string, any[]][]) {
    const ix = ms.findIndex(m => m.role === 'me' && m.text === e.question);
    if (ix < 0) continue;
    person = p;
    const next = ms.slice(ix + 1).find(m => m.role === 'me' || m.role === 'them' || m.role === 'note');
    response = next?.role !== 'me' ? next?.text ?? '' : '';
    kind = next?.kind ?? (next?.role === 'note' ? 'investigation' : '');
    facts = next?.facts ?? [];
  }
  return { id: `Q${String(n).padStart(2, '0')}`, person, style: ask?.style ?? '공감형 열린 질문', question: e.question, response, kind, facts, ms: e.ms, ai: !nonAi.has(n), auxiliary: auxiliary.has(n), note: n === 37 ? '리뷰어가 비서에게 할 질문을 권태석에게 보낸 조작 실수. 답변 적합성 평가에서 제외.' : n === 3 ? '일본어 스트레스 질문. 한국어 일반 플레이 통계와 분리.' : n === 45 ? '대기 중 자료 이동. 왕복이 지연에 영향을 줄 수 있어 기본 지연 통계와 분리.' : '' };
});
const voiced = '휴대폰에는 손도 대지 않았습니다. 그 친구가 제 휴대폰에서 글을 보고 옮겨 적은 것입니다. 비서 전화도 도현이가 받지 말라고 해서 제가 끊었습니다.';
const statement = STATEMENTS.find(s => s.id === 'C-09')!;
const beforePhone = new Set<string>(save.owned.filter((id: string) => id !== 'C-09'));
const question = rows.find((r: any) => r.id === 'Q40')!.question;
const requestQuestion = rows.find((r: any) => r.id === 'Q25')!.question;
const summary = {
  totalQuestions: rows.length,
  uiAiAll: summarize(rows.filter((r: any) => r.ai).map((r: any) => r.ms)),
  uiAiMain: summarize(rows.filter((r: any) => r.ai && !r.auxiliary).map((r: any) => r.ms)),
  uiNonAi: summarize(rows.filter((r: any) => !r.ai).map((r: any) => r.ms)),
  recoveredAttemptCount: stats.length,
  runtimeAttemptCount: raw.stats.all.attempts,
  failedAttempts: stats.filter(s => !s.ok).length,
  errors: stats.filter(s => !s.ok).map(s => ({ task: s.task, ms: s.ms, code: s.error?.includes('[429 ]') ? 429 : s.error })),
  tasks: Object.fromEntries(['interpret', 'write', 'voice', 'casual'].map(task => { const ss = stats.filter(s => s.task === task); return [task, { attempts: ss.length, failures: ss.filter(s => !s.ok).length, successful: ss.filter(s => s.ok).length, ...(ss.some(s => s.ok) ? summarize(ss.filter(s => s.ok).map(s => s.ms)) : {}) }]; })),
  userFailures: Object.values(save.chats).flat().filter((m: any) => m.status === 'failed').length,
  writtenAnswers: Object.values(save.chats).flat().filter((m: any) => m.kind === 'written').length,
  missing: ['A-F2', 'A-F9', 'A-02', 'E-14', 'C-08', 'C-05'].filter(id => !save.owned.includes(id)),
  result: save.result,
  checks: {
    phoneNegationAccepted: checkVoiced(voiced, [statement.say!], 'C', beforePhone, question) !== null,
    phoneSource: statement.say,
    phoneResponse: voiced,
    evidenceAssertionMisrouted: matchRequest(requestQuestion, new Set(save.owned))?.status,
    misroutedInvestigation: matchRequest(requestQuestion, new Set(save.owned))?.investigation.id,
  },
};
writeFileSync(dir + 'latency-summary.json', JSON.stringify(summary, null, 2));
writeFileSync(dir + 'api-attempts.json', JSON.stringify(stats, null, 2));
writeFileSync(dir + 'question-results.json', JSON.stringify(rows, null, 2));
const clean = (s: string) => s.replaceAll('|', '／').replaceAll('\n', ' ');
writeFileSync(dir + 'question-results.md', '# 네 번째 플레이 — 질문별 응답과 대기 시간\n\n45회 전체 기록. 시간은 보내기 클릭부터 답변 표시와 입력 재활성화까지다. Q03·Q37·Q45는 보조 관찰로 일반 지연 통계에서 분리했다. Q20·Q21·Q25는 AI를 거치지 않았다.\n\n| 번호 | 방식 | 초 | 질문 | 실제 응답 | 처리 유형 |\n|---|---|---:|---|---|---|\n' + rows.map((r: any) => `| ${r.id} | ${clean(r.style)} | ${(r.ms / 1000).toFixed(2)} | ${clean(r.question)} | ${clean(r.response)} | ${r.kind}${r.note ? ' · ' + r.note : ''} |`).join('\n') + '\n');
console.log(JSON.stringify(summary, null, 2));
