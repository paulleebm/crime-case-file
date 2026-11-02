import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as hotel from '../data/hotelCase';
import { FLOW_HINTS } from '../data/hints';
import { investigationById } from '../data/investigations';
import { USD_KRW } from '../ai/pricing';
import type { RunRow } from '../../server/playSummary';
import { Box, PencilDefs, Seal } from '../sketch/components';
import './logs.css';

// 운영자용 플레이 기록 열람 화면 (/bymile).
// /api/logs 가 Cloud Logging의 플레이 사건을 판 하나당 한 줄로 요약해 돌려준다 (server/playSummary.ts).
// 목록에는 요약만 쓰고, 판의 진행 흐름·대화는 그 칸을 펼칠 때 따로 불러온다.

type Ev = { uid: string; run: string; type: string; at: string | number; ip?: string; ep?: string } & Record<string, any>;

const KEY_STORE = 'bymile-viewer-key';
const LIST_STORE = 'bymile-viewer-list';
const isDev = !!import.meta.env?.DEV;
const loadKey = () => { try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; } };
const saveKey = (k: string) => { try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* noop */ } };
type ListCache = { days: number; runs: RunRow[]; at: number; cutoff?: number | null };
const loadList = (): ListCache | null => { try { const x = JSON.parse(localStorage.getItem(LIST_STORE) ?? 'null'); return x?.runs ? x : null; } catch { return null; } };
const saveList = (x: ListCache) => { try { localStorage.setItem(LIST_STORE, JSON.stringify(x)); } catch { /* noop */ } };

async function fetchLogs<T>(key: string, q: string, post?: unknown): Promise<T | 'key' | string> {
  try {
    const headers: Record<string, string> = key ? { 'X-Viewer-Key': key } : {};
    if (post !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(`/api/logs${q ? `?${q}` : ''}`, post === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(post) });
    if (r.status === 401) return 'key';
    if (r.status === 429) return '시도가 너무 많습니다. 10분 뒤 다시 해 주세요.';
    if (!r.ok) return `불러오지 못했습니다 (${r.status}).`;
    return await r.json();
  } catch (e) {
    return `불러오지 못했습니다: ${String(e)}`;
  }
}

// ── 이름표 ───────────────────────────────────────────

const ms = (at: string | number) => +new Date(at);
const KST = { timeZone: 'Asia/Seoul' } as const;
const time = (at: string | number) => new Date(at).toLocaleTimeString('en-GB', { ...KST, hourCycle: 'h23' });
const date = (at: string | number) => new Date(at).toLocaleDateString('ko-KR', { ...KST, month: 'numeric', day: 'numeric', weekday: 'short' });
const stamp = (at: string | number) => `${date(at)} ${time(at).slice(0, 5)}`;
function dur(m0: number) {
  const m = Math.round(m0 / 60000);
  if (m0 <= 0) return '0분';
  if (m < 1) return '1분 미만';
  return m < 60 ? `${m}분` : `${Math.floor(m / 60)}시간 ${m % 60}분`;
}
function ago(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 60 * 24) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
}
function won(usd: number) {
  const w = usd * USD_KRW;
  if (w === 0) return '₩0';
  if (w < 10) return `₩${w.toFixed(1)}`;
  return `₩${Math.round(w).toLocaleString('ko-KR')}`;
}
const dollars = (usd: number) => `$${usd < 1 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** 에피소드별 이름표 (에피소드마다 사람·자료 ID가 겹친다) */
interface Labels { title: string; short: string; persons: Record<string, { name: string; role?: string }>; ev: Map<string, string>; st: Map<string, { person: string; text: string }>; ch: Map<string, { person: string }>; job: (id: string) => string; hint: (k: string) => string | undefined }
const labels = (c: typeof hotel, short: string, job: (id: string) => string, hint: (k: string) => string | undefined): Labels => ({
  title: c.CASE_TITLE, short, persons: c.PERSONS as Labels['persons'],
  ev: new Map(c.EVIDENCE.map((e) => [e.id, e.title])),
  st: new Map(c.STATEMENTS.map((s) => [s.id, { person: s.person, text: s.text }])),
  ch: new Map(c.CHALLENGES.map((x) => [x.id, x])),
  job, hint,
});
const FLOW = new Map(FLOW_HINTS.map((f) => [f.key, f.title]));
const EP: Record<string, Labels> = {
  'gold-trophy': labels(hotel, '본편 01', (id) => investigationById.get(id)?.label ?? id, (k) => FLOW.get(k)),
};
const epOf = (ep: string) => EP[ep] ?? EP['gold-trophy'];
const challengeCount = (ep: string) => epOf(ep).ch.size;

function namer(L: Labels) {
  const who = (p: string) => (p === 'team' ? '수사팀' : L.persons[p]?.name ?? p);
  const chName = (id: string) => { const c = L.ch.get(id); return c ? `${who(c.person)}의 거짓 깨기` : id; };
  return {
    who, chName,
    item: (id: string) => {
      const t = L.ev.get(id);
      if (t) return t;
      const p = L.st.get(id)?.person ?? (/^[ABC]-/.test(id) ? id[0] : null);
      return p ? `${who(p)} 진술 ${id}` : id;
    },
    tip: (id: string) => L.st.get(id)?.text ?? id,
    hint: (k: string) => L.hint(k) ?? (L.ch.has(k) ? chName(k) : k),
    job: L.job,
  };
}
type Namer = ReturnType<typeof namer>;

const GRADE: Record<string, string> = { perfect: '완벽 해결', solved: '해결', insufficient: '근거 부족', wrong: '오답' };
const SCREEN: Record<string, string> = { briefing: '브리핑', hub: '수사', result: '결과', epilogue: '진상', afterword: '후일담' };
const OUTCOME: Record<string, string> = { success: '진술 정정', fact: '답변', cont: '이어서', ack: '맞장구', written: '진술서', deflect: '회피', unsupported: '근거 부족', record: '기록', answer: '답변', nearMiss: '빗나감', irrelevant: '무관', unknown: '모름', clarify: '되물음', repeat: '반복', offtopic: '딴 얘기' };
const TASK: Record<string, string> = { talk: '대화', statement: '진술 정리', interpret: '질문 해석', desk: '자료 대조', team: '수사팀', voice: '말투', write: '진술서', grade: '채점', hint: '힌트', casual: '잡담' };
function browser(ua?: string) {
  if (!ua) return '';
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const br = /Claude\//.test(ua) ? 'Claude 앱' : /Edg\//.test(ua) ? 'Edge' : /Whale\//.test(ua) ? 'Whale' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return [os, br].filter(Boolean).join(' · ');
}
/** 아무것도 하지 않고 닫은 판 (표지만 보고 나감) */
const isEmpty = (r: RunRow) => !r.grade && r.ai.calls === 0 && r.done === 0 && r.activeMs < 60_000;

// ── 묶음 ─────────────────────────────────────────────

interface Group { key: string; ip: string | null; uids: Set<string>; runs: RunRow[]; last: number; usd: number; activeMs: number }

function groupByIp(runs: RunRow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const r of runs) {
    const key = r.ip ? `ip:${r.ip}` : `uid:${r.uid}`;
    let g = groups.get(key);
    if (!g) { g = { key, ip: r.ip, uids: new Set(), runs: [], last: 0, usd: 0, activeMs: 0 }; groups.set(key, g); }
    g.uids.add(r.uid);
    g.runs.push(r);
    g.last = Math.max(g.last, r.last);
    g.usd += r.ai.usd;
    g.activeMs += r.activeMs;
  }
  for (const g of groups.values()) g.runs.sort((a, b) => b.last - a.last);
  return [...groups.values()].sort((a, b) => b.last - a.last);
}

// ── 접고 펴기 ─────────────────────────────────────────

/** 「모두 펼치기 / 모두 접기」 신호. 번호가 바뀔 때마다 depth 이하 칸이 open으로 맞춘다 (불러오기가 필요한 칸은 따르지 않는다) */
const FoldSignal = createContext<{ n: number; open: boolean; depth: number }>({ n: 0, open: false, depth: 0 });

function Fold({ head, children, defaultOpen = false, level, className = '', seed, mode = 'single', onOpen, lazy }: {
  head: ReactNode; children: ReactNode; defaultOpen?: boolean; level: number; className?: string; seed?: string; mode?: 'single' | 'double' | 'dash'; onOpen?: () => void; lazy?: boolean;
}) {
  const sig = useContext(FoldSignal);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (sig.n && level <= sig.depth && !(lazy && sig.open)) setOpen(sig.open); }, [sig, level, lazy]);
  useEffect(() => { if (open) onOpen?.(); }, [open, onOpen]);
  return (
    <Box className={`fold lv${level} ${open ? 'open' : ''} ${className}`} seed={seed} mode={mode}>
      <button className="fold-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="fold-arrow" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <div className="fold-title">{head}</div>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </Box>
  );
}

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  return (
    <span className="meter" title={`${label} ${value}/${max}`}>
      <span className="meter-k">{label}</span>
      <span className="meter-track"><i style={{ width: `${Math.min(100, (value / Math.max(1, max)) * 100)}%` }} /></span>
      <span className="meter-v">{value}/{max}</span>
    </span>
  );
}

function GradeStamp({ r }: { r: RunRow }) {
  if (r.grade) return <span className={`grade-stamp g-${r.grade}`}>{GRADE[r.grade] ?? r.grade}</span>;
  return <span className="grade-stamp g-open">진행 중{r.screen && SCREEN[r.screen] ? ` · ${SCREEN[r.screen]}` : ''}</span>;
}

function Cost({ r }: { r: RunRow }) {
  const a = r.ai;
  const tip = [`${dollars(a.usd)} (1$ = ₩${USD_KRW.toLocaleString()})`, `AI 요청 ${a.calls}회 · 실패 ${a.fails}`, `토큰 ${a.tokens.toLocaleString()}`, ...Object.entries(a.models).map(([m, n]) => `${m} ${n}회`)].join('\n');
  if (a.calls === 0) return <span className="cost none" title={tip}>AI 없음</span>;
  const allUnpriced = a.unpriced > 0 && a.usd === 0;
  return (
    <span className={`cost ${allUnpriced ? 'none' : ''}`} title={tip}>
      {allUnpriced ? '단가 미상' : won(a.usd)}
      {a.unpriced > 0 && !allUnpriced && <sup title="모델이 기록되지 않아 값을 셀 수 없는 요청">+{a.unpriced}</sup>}
    </span>
  );
}

// ── 한 판 ─────────────────────────────────────────────

function RunHead({ r }: { r: RunRow }) {
  return (
    <div className="run-head">
      <span className={`ep-tag ept-${r.ep}`}>{epOf(r.ep).short}</span>
      <div className="run-when">
        <b>{stamp(r.first)}</b>
        <span className="muted"> · {dur(r.activeMs)}{r.sessions > 1 ? ` · 접속 ${r.sessions}회` : ''}</span>
        {r.runs.length > 1 && <span className="tag" title={r.runs.join('\n')}>이어 한 판 {r.runs.length}개 합침</span>}
      </div>
      <div className="run-progress">
        <Meter label="지적" value={r.done} max={challengeCount(r.ep)} />
        <span className="stat">힌트 <b>{r.hints}</b></span>
      </div>
      <Cost r={r} />
      <GradeStamp r={r} />
    </div>
  );
}

type Load = { state: 'loading' } | { state: 'error'; msg: string } | { state: 'ok'; events: Ev[] };

/** 판의 한 부분(진행 흐름 / 대화)을 펼칠 때 한 번 불러온다 */
function usePart(r: RunRow, apiKey: string, part: 'flow' | 'chat') {
  const [d, setD] = useState<Load | null>(null);
  const load = useCallback(() => {
    if (d && d.state !== 'error') return;
    setD({ state: 'loading' });
    void fetchLogs<{ events: Ev[] }>(apiKey, `runs=${r.runs.join(',')}&from=${r.first}&to=${r.last}&part=${part}`).then((x) => {
      if (typeof x === 'string') setD({ state: 'error', msg: x === 'key' ? '열람 키가 맞지 않습니다.' : x });
      // 예전에는 에피소드끼리 판 ID를 같이 썼다. 에피소드가 적힌 사건은 이 판 것만 남긴다
      else setD({ state: 'ok', events: x.events.filter((e) => !e.ep || e.ep === r.ep).sort((a, b) => ms(a.at) - ms(b.at)) });
    });
  }, [d, apiKey, part, r]);
  return [d, load] as const;
}

function Loading({ d, children }: { d: Load | null; children: (events: Ev[]) => ReactNode }) {
  if (!d || d.state === 'loading') return <p className="muted pad">불러오는 중…</p>;
  if (d.state === 'error') return <p className="err pad">{d.msg}</p>;
  return <>{children(d.events)}</>;
}

function RunFold({ r, apiKey }: { r: RunRow; apiKey: string }) {
  const n = useMemo(() => namer(epOf(r.ep)), [r.ep]);
  const [flow, loadFlow] = usePart(r, apiKey, 'flow');
  const [chat, loadChat] = usePart(r, apiKey, 'chat');
  const tasks = Object.entries(r.ai.byTask).sort((a, b) => b[1].usd - a[1].usd || b[1].calls - a[1].calls);
  return (
    <Fold level={2} className="run" seed={r.id} head={<RunHead r={r} />}>
      <div className="run-meta code">
        {epOf(r.ep).title} · {stamp(r.first)} ~ {stamp(r.last)}{r.ip ? ` · ${r.ip}` : ""} · 기기 {r.uid}{r.ua ? ` · ${browser(r.ua)}` : ''}
        <br />판 {r.runs.join(', ')}
      </div>
      {r.ai.calls > 0 && (
        <table className="cost-table">
          <thead><tr><th>AI 작업</th><th>요청</th><th>비용</th></tr></thead>
          <tbody>
            {tasks.map(([t, x]) => <tr key={t}><td>{TASK[t] ?? t}</td><td>{x.calls}</td><td>{x.usd ? won(x.usd) : '-'}</td></tr>)}
            <tr className="sum"><td>합계{r.ai.fails ? <span className="muted"> · 실패 {r.ai.fails}</span> : null}</td><td>{r.ai.calls}</td><td>{r.ai.usd ? <>{won(r.ai.usd)} <span className="muted">{dollars(r.ai.usd)}</span></> : '단가 미상'}{r.ai.unpriced && r.ai.usd ? <span className="muted"> +미상 {r.ai.unpriced}</span> : null}</td></tr>
          </tbody>
        </table>
      )}
      <Fold level={3} mode="dash" lazy className="sub" onOpen={loadFlow} head={<span className="sub-head">진행 흐름 · 힌트 {flow?.state === 'ok' ? <span className="muted">· {flow.events.filter((e) => flowLine(e, false, n)).length}건</span> : <span className="muted">· 눌러서 불러오기</span>}</span>}>
        <Loading d={flow}>{(events) => <Flow events={events} n={n} />}</Loading>
      </Fold>
      <Fold level={3} mode="dash" lazy className="sub" onOpen={loadChat} head={<span className="sub-head">대화 {chat?.state === 'ok' ? <span className="muted">· 질문 {chat.events.filter((e) => e.type === 'chat' && e.role === 'me').length}개</span> : <span className="muted">· 눌러서 불러오기</span>}</span>}>
        <Loading d={chat}>{(events) => <Talks events={events} n={n} persons={epOf(r.ep).persons} />}</Loading>
      </Fold>
    </Fold>
  );
}

function Flow({ events, n }: { events: Ev[]; n: Namer }) {
  const [verbose, setVerbose] = useState(false);
  const timeline = events.filter((e) => flowLine(e, verbose, n));
  const ai = events.filter((e) => e.type === 'ai');
  const okMs = ai.filter((e) => e.ok).map((e) => e.ms as number).sort((a, b) => a - b);
  return (
    <>
      <label className="verbose"><input type="checkbox" checked={verbose} onChange={(e) => setVerbose(e.target.checked)} /> 자료 열람·화면 이동·AI 실패까지 보기</label>
      <ol className="flow">
        {timeline.map((e, i) => {
          const l = flowLine(e, verbose, n)!;
          return (
            <li key={i} className={`flow-${l.tone ?? 'plain'}`}>
              <span className="flow-t">{time(e.at)}</span>
              <span className="flow-x">{l.text}{e.idle >= 120 && (e.type === 'hint' || e.type === 'open') ? <span className="idle"> · 진전 없이 {Math.round(e.idle / 60)}분</span> : null}</span>
            </li>
          );
        })}
      </ol>
      <div className="ai-stat code">AI 요청 {ai.length}회 · 실패 {ai.length - okMs.length} · 응답 중앙값 {okMs[Math.floor(okMs.length / 2)] ?? '-'}ms</div>
    </>
  );
}

function Talks({ events, n, persons: info }: { events: Ev[]; n: Namer; persons: Labels['persons'] }) {
  // 사람별. 기록 시작 전 대화(backfill)는 앞에 따로 둔다
  const people = new Map<string, { before: any[]; msgs: Ev[] }>();
  const slot = (p: string) => { let s = people.get(p); if (!s) { s = { before: [], msgs: [] }; people.set(p, s); } return s; };
  for (const e of events) {
    if (e.type === 'backfill') slot(e.person).before.push(...(e.msgs ?? []));
    if (e.type === 'chat') slot(e.person).msgs.push(e);
  }
  const order = ['A', 'B', 'C', 'team'];
  const persons = [...people.keys()].sort((a, b) => (order.indexOf(a) + 9) % 9 - (order.indexOf(b) + 9) % 9);
  if (persons.length === 0) return <p className="muted pad">이 판에는 대화가 없습니다.</p>;
  return (
    <>
      {persons.map((p) => {
        const s = people.get(p)!;
        const asked = s.msgs.filter((m) => m.role === 'me').length + s.before.filter((m) => m.role === 'me').length;
        return (
          <Fold key={p} level={4} className="talk" seed={p} head={
            <span className="talk-head">
              <Seal text={p === 'team' ? '팀' : n.who(p).slice(0, 1)} size={26} />
              <b>{n.who(p)}</b>
              {p !== 'team' && <span className="muted">{info[p]?.role}</span>}
              <span className="muted">· 질문 {asked}</span>
            </span>
          }>
            <div className="convo">
              {s.before.length > 0 && <div className="convo-sep">기록 시작 전 대화</div>}
              {s.before.map((m, i) => <Bubble key={`b${i}`} m={m} name={n.who(p)} />)}
              {s.before.length > 0 && s.msgs.length > 0 && <div className="convo-sep">이후 기록</div>}
              {s.msgs.map((m, i) => <Bubble key={i} m={m} name={n.who(p)} at={m.at} />)}
            </div>
          </Fold>
        );
      })}
    </>
  );
}

function Bubble({ m, name, at }: { m: any; name: string; at?: string | number }) {
  if (m.role === 'note') {
    return <div className={`note-line ${m.hint ? 'hint' : ''}`}>{at && <span className="flow-t">{time(at)}</span>}{m.hint ? '수첩 · ' : '기록 · '}{m.text}{m.sub ? ` — ${m.sub}` : ''}</div>;
  }
  const me = m.role === 'me';
  const outcome = m.outcome ?? m.kind;
  return (
    <div className={`msg ${me ? 'me' : 'them'} ${m.status === 'failed' ? 'failed' : ''}`}>
      <div className="who">
        {me ? '형사' : name}{at ? ` · ${time(at)}` : ''}
        {!me && outcome && outcome !== 'play' && <span className={`oc oc-${outcome}`}>{OUTCOME[outcome] ?? outcome}</span>}
        {m.record && <span className="oc oc-record">기록 {m.record}</span>}
        {m.status === 'failed' && <span className="oc oc-fail">응답 실패{m.error ? ` · ${m.error}` : ''}</span>}
      </div>
      <div className="msg-text">{m.text}</div>
      {!me && m.facts?.length ? <div className="facts code">주제 {m.facts.join(', ')}</div> : null}
    </div>
  );
}

function flowLine(e: Ev, verbose: boolean, n: Namer): { text: ReactNode; tone?: string } | null {
  switch (e.type) {
    case 'start': return { text: <b>새 게임 시작</b>, tone: 'mark' };
    case 'resume': return { text: <><b>이어 하기</b> <span className="muted">(자료 {e.owned}, 지적 {e.done})</span></>, tone: 'mark' };
    case 'backfill_state': return { text: <span className="muted">이어 하기 전 상태: 자료 {e.owned?.length ?? 0}, 지적 {e.done?.length ?? 0}{e.done?.length ? ` (${e.done.map(n.chName).join(', ')})` : ''}, 힌트 {e.hints}</span> };
    case 'reveal': return { text: <>새 자료 · {(e.ids as string[]).map((id) => <span key={id} className="chip" title={n.tip(id)}>{n.item(id)}</span>)}{e.toast ? <span className="muted"> {e.toast}</span> : null}</>, tone: 'good' };
    case 'solve': return { text: <><b>지적 성공</b> · {n.chName(e.id)} <span className="code">{e.id}</span></>, tone: 'win' };
    case 'hint': return { text: <>힌트 · {n.hint(e.key)} {e.level}단계 <span className="muted">(누적 {e.uses})</span></>, tone: 'hint' };
    case 'team_start': return { text: <>수사팀 조사 요청 · {(e.jobs as string[]).map((id) => <span key={id} className="chip team" title={id}>{n.job(id)}</span>)}</>, tone: 'team' };
    case 'team_result': return { text: <>수사팀 결과 도착 · {(e.docs as string[]).map((id) => <span key={id} className="chip" title={n.tip(id)}>{n.item(id)}</span>)}</>, tone: 'team' };
    case 'chat_fail': return { text: <>응답 실패 · {n.who(e.person)} <span className="muted">{e.error}</span></>, tone: 'bad' };
    case 'report': return verbose ? { text: <span className="muted">보고서 작성 {Object.keys(e.patch ?? {}).join(', ')}</span> } : null;
    case 'result': return { text: <><b>보고서 제출 · {GRADE[e.grade] ?? e.grade}</b> <span className="muted">(범인 {e.culpritOk ? '맞음' : '틀림'}, 자료 {e.owned}, 지적 {e.done}, 힌트 {e.hints})</span></>, tone: e.grade === 'wrong' ? 'bad' : 'win' };
    case 'screen': return verbose || e.screen === 'result' || e.screen === 'epilogue' ? { text: <span className="muted">화면 · {SCREEN[e.screen] ?? e.screen}</span> } : null;
    case 'open': return verbose ? { text: <span className="muted">열람 · {e.ref ? n.item(e.ref) : e.tab}</span> } : null;
    case 'ai': return verbose && !e.ok ? { text: <>AI 실패 · {TASK[e.task] ?? e.task} {e.route} {e.ms}ms <span className="muted">{e.error}</span></>, tone: 'bad' } : null;
    default: return null;
  }
}

// ── 화면 ─────────────────────────────────────────────

function KeyGate({ onKey, msg }: { onKey: (k: string) => void; msg?: string }) {
  const [v, setV] = useState('');
  return (
    <div className="gate">
      <Box className="gate-card sheet" mode="double" seed="gate">
        <div className="code">열람 제한 · 운영자 전용</div>
        <h1>플레이 기록 열람실</h1>
        <p className="muted">열람 키를 넣으면 이 브라우저에 기억합니다.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (v.trim()) onKey(v.trim()); }}>
          <Box className="gate-input" seed="gate-in"><input type="password" value={v} onChange={(e) => setV(e.target.value)} placeholder="열람 키" autoFocus autoComplete="current-password" /></Box>
          <Box as="button" className="btn" seed="gate-btn" type="submit">열기</Box>
        </form>
        {msg && <p className="err">{msg}</p>}
      </Box>
    </div>
  );
}

export default function LogViewer() {
  const [apiKey, setApiKey] = useState(loadKey);
  const cached = useMemo(loadList, []);
  const [days, setDays] = useState(cached?.days ?? 7);
  const [data, setData] = useState<ListCache | null>(cached);
  const [err, setErr] = useState<string | null>(null);
  const [needKey, setNeedKey] = useState(!isDev && !loadKey());
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [only, setOnly] = useState<'all' | 'done' | 'open'>('all');
  const [ep, setEp] = useState<'all' | string>('all');
  const [showEmpty, setShowEmpty] = useState(false);
  const [byIp, setByIp] = useState(true);
  const [sig, setSig] = useState({ n: 0, open: false, depth: 0 });

  const refresh = useCallback(async (key = apiKey, d = days) => {
    setLoading(true);
    const x = await fetchLogs<ListCache>(key, `days=${d}`);
    setLoading(false);
    if (x === 'key') { setNeedKey(true); setErr(key ? '열람 키가 맞지 않습니다.' : null); return; }
    if (typeof x === 'string') { setErr(x); return; }
    const next = { days: d, runs: x.runs, at: x.at, cutoff: x.cutoff ?? null };
    setErr(null); setNeedKey(false); setData(next); saveList(next);
  }, [apiKey, days]);

  // 이 시각 이전 기록은 목록에서 감춘다 (기록은 지우지 않는다). since가 null이면 다시 모두 보인다
  const setCutoff = async (since: number | null) => {
    if (since !== null && !window.confirm(`${stamp(since)} 이전 플레이 기록을 목록에서 감춥니다.
기록 자체는 지우지 않으며, 「다시 모두 보기」로 되돌릴 수 있습니다.`)) return;
    setLoading(true);
    const x = await fetchLogs<{ since: number | null }>(apiKey, '', { since });
    setLoading(false);
    if (typeof x === 'string') { setErr(x === 'key' ? '열람 키가 맞지 않습니다.' : x); return; }
    await refresh();
  };

  // 목록은 판마다 요약 한 줄이라 가볍다. 들어오면 바로 새로 읽고, 그동안 지난번 목록을 보여 준다
  useEffect(() => { if (!needKey) void refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runs = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    let xs = data.runs;
    if (!showEmpty) xs = xs.filter((r) => !isEmpty(r));
    if (ep !== 'all') xs = xs.filter((r) => r.ep === ep);
    if (only === 'done') xs = xs.filter((r) => r.grade);
    if (only === 'open') xs = xs.filter((r) => !r.grade);
    if (needle) xs = xs.filter((r) => [r.ip, r.uid, ...r.runs].some((x) => x?.toLowerCase().includes(needle)));
    return xs;
  }, [data, q, only, ep, showEmpty]);
  const groups = useMemo(() => groupByIp(runs), [runs]);

  if (needKey) return <><PencilDefs /><KeyGate msg={err ?? undefined} onKey={(k) => { saveKey(k); setApiKey(k); void refresh(k); }} /></>;

  const solved = runs.filter((r) => r.grade && r.grade !== 'wrong').length;
  const usd = runs.reduce((s, r) => s + r.ai.usd, 0);
  const played = runs.filter((r) => r.ai.usd > 0);
  const activeMs = runs.reduce((s, r) => s + r.activeMs, 0);
  const hidden = data ? data.runs.filter(isEmpty).length : 0;
  const all = (open: boolean, depth: number) => setSig((s) => ({ n: s.n + 1, open, depth }));

  return (
    <div className="logv">
      <PencilDefs />
      <Box className="logv-top sheet" mode="double" seed="logv-top">
        <div className="tb-cell grow">
          <span className="k">운영자 · {data?.cutoff ? `${stamp(data.cutoff)} 이후` : `최근 ${data?.days ?? days}일`}</span>
          <span className="case">플레이 기록</span>
        </div>
        <div className="tb-cell"><span className="k">판</span><span className="v">{runs.length}</span></div>
        <div className="tb-cell"><span className="k">해결</span><span className="v">{solved}</span></div>
        <div className="tb-cell"><span className="k">플레이 시간</span><span className="v">{dur(activeMs)}</span></div>
        <div className="tb-cell"><span className="k">AI 비용</span><span className="v" title={dollars(usd)}>{won(usd)}</span></div>
        <div className="tb-cell"><span className="k">판당 평균</span><span className="v" title="비용이 잡힌 판 기준">{played.length ? won(usd / played.length) : '-'}</span></div>
      </Box>

      <div className="logv-tools">
        <label className="tool">기간
          <select value={days} onChange={(e) => { const d = Number(e.target.value); setDays(d); void refresh(apiKey, d); }}>
            {[1, 3, 7, 14, 30].map((d) => <option key={d} value={d}>최근 {d}일</option>)}
          </select>
        </label>
        <label className="tool">에피소드
          <select value={ep} onChange={(e) => setEp(e.target.value)}>
            <option value="all">전체</option>
            {Object.entries(EP).map(([k, L]) => <option key={k} value={k}>{L.short}</option>)}
          </select>
        </label>
        <label className="tool">결과
          <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
            <option value="all">전체</option><option value="done">제출한 판</option><option value="open">진행 중</option>
          </select>
        </label>
        <Box className="tool search" seed="search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="IP · 기기 · 판 ID" /></Box>
        <label className="tool toggle"><input type="checkbox" checked={byIp} onChange={(e) => setByIp(e.target.checked)} /> 주소별 묶기</label>
        <label className="tool toggle"><input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> 빈 판 보기{hidden ? ` (${hidden})` : ''}</label>
        <span className="grow" />
        {data?.cutoff
          ? <span className="cutoff">{stamp(data.cutoff)} 이전 감춤 <button className="btn small" onClick={() => void setCutoff(null)} disabled={loading}>다시 모두 보기</button></span>
          : <button className="btn small" onClick={() => void setCutoff(Date.now())} disabled={loading || !data} title="지금까지의 기록을 목록에서 감춥니다 (지우지 않음)">지금 이전 기록 감추기</button>}
        {byIp && <button className="btn small" onClick={() => all(true, 1)}>모두 펼치기</button>}
        <button className="btn small" onClick={() => all(false, 2)}>모두 접기</button>
        <Box as="button" className="btn small" seed="refresh" onClick={() => void refresh()} disabled={loading}>{loading ? '불러오는 중…' : '새로 고침'}</Box>
        {!isDev && <button className="btn small muted" onClick={() => { saveKey(''); setApiKey(''); setNeedKey(true); setData(null); }}>잠그기</button>}
      </div>

      {err && <p className="err">{err}</p>}
      {data && <p className="as-of muted">{ago(data.at)} 기준{loading ? ' · 새로 읽는 중…' : ''}</p>}
      {!data && !err && <p className="muted pad">기록을 불러오는 중…</p>}
      {data && runs.length === 0 && <p className="muted pad">조건에 맞는 플레이 기록이 없습니다.</p>}

      <FoldSignal.Provider value={sig}>
        {byIp ? (
          <div className="groups">
            {groups.map((g) => {
              const done = g.runs.filter((r) => r.grade).length;
              return (
                <Fold key={g.key} level={1} mode="double" className="group" seed={g.key} head={
                  <div className="group-head">
                    <div className="group-id">
                      <span className="k code">{g.ip ? 'IP' : 'IP 기록 이전'}{g.uids.size > 1 ? ` · 기기 ${g.uids.size}대` : ''}</span>
                      <b className="mono">{g.ip ?? `기기 ${[...g.uids][0]}`}</b>
                    </div>
                    <span className="stat">판 <b>{g.runs.length}</b>{done ? <> · 제출 <b>{done}</b></> : null}</span>
                    <span className="stat">플레이 <b>{dur(g.activeMs)}</b></span>
                    <span className="stat">비용 <b>{won(g.usd)}</b></span>
                    <span className="ep-list">{[...new Set(g.runs.map((r) => r.ep))].map((x) => <span key={x} className={`ep-tag ept-${x}`}>{epOf(x).short}</span>)}</span>
                    <span className="grow" />
                    <span className="muted when">{ago(g.last)}</span>
                  </div>
                }>
                  <div className="runs">{g.runs.map((r) => <RunFold key={r.id + r.ep} r={r} apiKey={apiKey} />)}</div>
                </Fold>
              );
            })}
          </div>
        ) : (
          <div className="runs flat">{runs.map((r) => <RunFold key={r.id + r.ep} r={r} apiKey={apiKey} />)}</div>
        )}
      </FoldSignal.Provider>
    </div>
  );
}
