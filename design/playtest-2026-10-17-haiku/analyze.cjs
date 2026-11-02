const fs = require('node:fs');
const path = require('node:path');
const run = 'mvbc1ra0gts03e5s';
const out = __dirname;
const root = path.resolve(out, '../..');
const events = fs.readFileSync(path.join(root, 'dev-logs/play.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse).filter(e => e.run === run).sort((a,b) => +new Date(a.at) - +new Date(b.at));
const names = { A: '류준서', B: '서민아', C: '문태준', team: '수사팀' };
const turns = [], latest = {};
for (const e of events.filter(e => e.type === 'chat')) {
  if (e.role === 'me') {
    const t = { no: turns.length + 1, person: e.person, name: names[e.person], at: new Date(e.at).toISOString(), question: e.text, attached: e.attached || [], replies: [] };
    turns.push(t); latest[e.person] = t;
  } else if (e.role === 'them' && latest[e.person]) {
    latest[e.person].replies.push({ at: new Date(e.at).toISOString(), text: e.text, outcome: e.outcome || null });
  }
}
function distribution(xs) {
  const v = xs.slice().sort((a,b) => a-b);
  const q = p => v.length ? v[Math.max(0, Math.ceil(v.length*p)-1)] : null;
  return { n: v.length, p50Ms: q(.5), p90Ms: q(.9), maxMs: v.at(-1) ?? null };
}
for (const t of turns) {
  t.firstReplyMs = t.replies.length ? +new Date(t.replies[0].at) - +new Date(t.at) : null;
  t.lastReplyMs = t.replies.length ? +new Date(t.replies.at(-1).at) - +new Date(t.at) : null;
}
const ai = events.filter(e => e.type === 'ai');
const stats = {
  run, startedAt: new Date(events.find(e=>e.type==='start').at).toISOString(),
  lastQuestionAt: turns.at(-1).at,
  questions: turns.length,
  counts: Object.fromEntries(Object.entries(names).map(([p,n])=>[n,turns.filter(t=>t.person===p).length])),
  solvedChallenges: events.filter(e=>e.type==='solve').map(e=>e.id),
  submitted: events.some(e=>e.type==='result'),
  aiCalls: ai.length, aiFailed: ai.filter(e=>!e.ok).length,
  aiByTask: Object.fromEntries([...new Set(ai.map(e=>e.task))].map(task=>[task, distribution(ai.filter(e=>e.task===task && e.ok).map(e=>e.ms))])),
  firstReply: distribution(turns.filter(t=>t.firstReplyMs!==null).map(t=>t.firstReplyMs)),
  lastReply: distribution(turns.filter(t=>t.lastReplyMs!==null).map(t=>t.lastReplyMs)),
  firstReplyByPerson: Object.fromEntries(Object.entries(names).map(([p,n])=>[n,distribution(turns.filter(t=>t.person===p && t.firstReplyMs!==null).map(t=>t.firstReplyMs))]))
};
fs.writeFileSync(path.join(out,'events.json'), JSON.stringify(events.map(({uid,ip,...e})=>e),null,2)+'\n');
fs.writeFileSync(path.join(out,'turns.json'),JSON.stringify(turns,null,2)+'\n');
fs.writeFileSync(path.join(out,'stats.json'),JSON.stringify(stats,null,2)+'\n');
const clock = s=>new Date(s).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour12:false});
const md = ['# Haiku 화면 플레이 대화 전문','', '2026-10-17 KST · 게임 UI에서 직접 입력 · run `'+run+'`','', '숫자는 질문 등록부터 첫/마지막 답 말풍선의 플레이 로그 시각 차이다. 분할 답변을 모두 모았다. DOM 확인 도구의 실행 시간이나 순수 모델 추론 시간과 다르다.',''];
for(const t of turns){
  md.push(`## Q${String(t.no).padStart(2,'0')} · ${t.name} · ${clock(t.at)}`, '', '**수사관:** '+t.question, '', `첫 답 ${t.firstReplyMs}ms · 마지막 답 ${t.lastReplyMs}ms`, '');
  for(const r of t.replies) md.push(`**${t.name}:** ${r.text}`, '');
}
fs.writeFileSync(path.join(out,'transcript.md'),md.join('\n'));
console.log(JSON.stringify(stats,null,2));
console.log(turns.map(t=>`Q${String(t.no).padStart(2,'0')} ${t.name}: ${t.question}`).join('\n'));
