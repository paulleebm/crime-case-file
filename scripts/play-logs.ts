import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PERSONS } from '../src/data/case';

// 플레이 기록 보기. Cloud Logging에 남은 플레이 사건(jsonPayload.kind="play")을 판(run)별 읽기 쉬운 기록으로 만든다.
//   npx tsx scripts/play-logs.ts            최근 7일
//   npx tsx scripts/play-logs.ts 3          최근 3일
//   npx tsx scripts/play-logs.ts 7 <run>    한 판만
//   npx tsx scripts/play-logs.ts --local    로컬 개발 서버 기록(dev-logs/play.jsonl)
// 결과: dev-logs/plays/<날짜>_<run>.md (판마다 하나), 화면에는 판별 요약

const PROJECT = 'crime-case-file';
const args = process.argv.slice(2);
const local = args.includes('--local');
const [daysArg, only] = args.filter((a) => !a.startsWith('--'));
const days = Number(daysArg) || 7;

type Ev = { uid: string; run: string; type: string; at: string | number } & Record<string, any>;

function load(): Ev[] {
  if (local) {
    const f = path.join('dev-logs', 'play.jsonl');
    return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  // 2026-10-14 전에는 답의 kind가 기록 표시를 덮어썼다. 그 답은 message로 찾는다
  const filter = `(jsonPayload.kind="play" OR jsonPayload.message="play chat")${only ? ` AND jsonPayload.run="${only}"` : ''}`;
  const out = execSync(`gcloud logging read "${filter.replace(/"/g, '\\"')}" --project ${PROJECT} --freshness=${days}d --order=asc --limit=100000 --format=json`, { maxBuffer: 1 << 30, encoding: 'utf8', env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  return (JSON.parse(out) as { jsonPayload: Ev }[]).map((x) => x.jsonPayload);
}

const time = (at: string | number) => new Date(at).toLocaleTimeString('en-GB', { hourCycle: 'h23', timeZone: 'Asia/Seoul' });
const who = (p: string) => (p === 'team' ? '수사팀' : (PERSONS as Record<string, { name: string }>)[p]?.name ?? p);

function line(e: Ev): string | null {
  const t = `\`${time(e.at)}\``;
  const idle = e.idle >= 120 ? ` _(진전 없이 ${Math.round(e.idle / 60)}분)_` : '';
  switch (e.type) {
    case 'start': return `${t} **새 게임 시작**`;
    case 'resume': return `${t} **이어 하기** (자료 ${e.owned}, 지적 ${e.done})`;
    case 'screen': return `${t} 화면: ${e.screen}`;
    case 'open': return `${t} 열기: ${e.tab}${e.ref ? ` ${e.ref}` : ''}${idle}`;
    case 'chat': {
      if (e.role === 'me') return `${t} [${who(e.person)}] **형사:** ${e.text}${idle}`;
      if (e.role === 'them') return `${t} [${who(e.person)}] **${who(e.person)}** _(${e.outcome ?? e.kind ?? '-'}${e.facts?.length ? ` · ${e.facts.join(',')}` : ''})_: ${e.text.replace(/\n+/g, ' ⏎ ')}`;
      return `${t} [${who(e.person)}] _${e.hint ? '수첩' : '기록'}: ${e.text}${e.sub ? ` — ${e.sub}` : ''}_`;
    }
    case 'team_start': return `${t} 🔎 수사팀 조사 시작: ${e.jobs.join(', ')}`;
    case 'team_result': return `${t} 📨 수사팀 결과 도착: ${e.docs.join(', ')}`;
    case 'chat_fail': return `${t} ⚠ 응답 실패: ${e.error}`;
    case 'chat_retry': return `${t} 다시 보내기`;
    case 'reveal': return `${t} ✅ 새 자료/진술: ${e.ids.join(', ')}${e.toast ? ` (${e.toast})` : ''}`;
    case 'solve': return `${t} ✅ 지적 성공: ${e.id}`;
    case 'hint': return `${t} 💡 힌트 ${e.key} ${e.level}단계 (누적 ${e.uses})${idle}`;
    case 'press': return null;
    case 'map': return null;
    case 'report': return `${t} 보고서: ${JSON.stringify(e.patch)}`;
    case 'result': return `${t} **결과: ${e.grade}** (범인 ${e.culpritOk ? '맞음' : '틀림'}, 힌트 ${e.hints})`;
    case 'ai': return e.ok ? null : `${t} ⚠ AI ${e.task} ${e.route} 실패 ${e.ms}ms: ${e.error}`;
    case 'backfill_state': return `${t} _(이전 상태: 자료 ${e.owned.length}, 지적 ${e.done.length}, 힌트 ${e.hints}, 결과 ${e.result ?? '-'})_`;
    default: return null;
  }
}

/** 100만 토큰당 달러 (claude-sonnet-5-5). 기록에는 캐시 저장 시간이 없어 모두 5분 단가로 센다 (1시간 저장은 $4) */
const PRICE = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };
type Usage = Record<keyof typeof PRICE, number>;
function aiCost(ai: Ev[]) {
  const by: Record<string, Usage & { n: number; usd: number }> = {};
  for (const e of ai) {
    if (!e.usage) continue;
    const c = by[e.task] ??= { n: 0, usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    c.n++;
    for (const k of Object.keys(PRICE) as (keyof typeof PRICE)[]) { c[k] += e.usage[k] ?? 0; c.usd += (e.usage[k] ?? 0) * PRICE[k] / 1e6; }
  }
  return { by, total: Object.values(by).reduce((a, c) => a + c.usd, 0) };
}

const events = load();
const runs = new Map<string, Ev[]>();
for (const e of events) { if (!only || e.run === only) runs.set(e.run, [...(runs.get(e.run) ?? []), e]); }

const dir = path.join('dev-logs', 'plays');
fs.mkdirSync(dir, { recursive: true });
for (const [run, evs] of runs) {
  evs.sort((a, b) => +new Date(a.at) - +new Date(b.at));
  const md: string[] = [`# 플레이 ${run}`, `기기 ${evs[0].uid} · ${new Date(evs[0].at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} ~ ${time(evs[evs.length - 1].at)} (KST)`, ''];
  // 이 기능 전에 한 대화 (시각 없음)
  const back = evs.filter((e) => e.type === 'backfill');
  if (back.length) {
    md.push('## 이전 대화 (기록 시작 전)', '');
    const by = new Map<string, any[]>();
    for (const b of back.sort((a, c) => a.from - c.from)) by.set(b.person, [...(by.get(b.person) ?? []), ...b.msgs]);
    for (const [p, msgs] of by) {
      md.push(`### ${who(p)}`, '');
      for (const m of msgs) md.push(m.role === 'me' ? `- **형사:** ${m.text}` : m.role === 'them' ? `- **${who(p)}** _(${m.kind ?? '-'})_: ${m.text.replace(/\n+/g, ' ⏎ ')}` : `- _${m.text}${m.sub ? ` — ${m.sub}` : ''}_`);
      md.push('');
    }
    md.push('## 기록', '');
  }
  for (const e of evs) { const l = line(e); if (l) md.push(`- ${l}`); }
  const ai = evs.filter((e) => e.type === 'ai');
  const fails = ai.filter((e) => !e.ok).length;
  const ms = ai.filter((e) => e.ok).map((e) => e.ms).sort((a, b) => a - b);
  const says = evs.filter((e) => e.type === 'chat' && e.role === 'me').length;
  const hints = evs.filter((e) => e.type === 'hint').length;
  const result = evs.find((e) => e.type === 'result');
  md.push('', `AI 요청 ${ai.length}회 · 실패 ${fails} · 중앙값 ${ms[Math.floor(ms.length / 2)] ?? '-'}ms`);
  const cost = aiCost(ai);
  md.push('', `AI 비용 약 $${cost.total.toFixed(3)} (Sonnet 5.5 단가, 캐시 저장은 5분 단가로 셈)`, ...Object.entries(cost.by).map(([k, c]) => `- ${k}: ${c.n}회 $${c.usd.toFixed(3)} (입력 ${c.input} · 출력 ${c.output} · 캐시 읽기 ${c.cacheRead} · 캐시 저장 ${c.cacheWrite})`));
  const day = new Date(evs[0].at).toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, `${day}_${run}.md`), md.join('\n'));
  console.log(`${day} ${run}  질문 ${says} · 힌트 ${hints} · 이전대화 ${back.length ? '있음' : '-'} · 결과 ${result?.grade ?? '진행 중'} · AI $${cost.total.toFixed(2)} (${Object.entries(cost.by).map(([k, c]) => `${k} $${c.usd.toFixed(2)}`).join(', ')})`);
}
console.log(`\n${runs.size}판 → ${dir}`);
