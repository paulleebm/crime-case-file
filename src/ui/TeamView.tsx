import { useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { MAX_DESK_INPUT as MAX_TEAM_INPUT } from '../ai/desk';
import { docTitle } from '../engine/lookup';
import { useGame, type ChatMsg } from '../engine/state';
import { MAX_TEAM_JOBS, jobDueAt, type TeamJob } from '../engine/investigation';
import { Box, InkStamp } from '../sketch/components';
import { PencilCaret } from './PencilCaret';
import { appendDropped, isTextDrag } from './EvidenceTray';
import teamRadio from '../assets/ui/icon-team.webp';
import { ArtIcon } from './ArtIcon';
import { sendTeam } from './teamChat';

/** 1초마다 다시 그린다 (남은 시간 표시) */
export function useNow(on: boolean, ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [on, ms]);
  return now;
}

/** "1:42" */
export const clock = (ms: number) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

/** 수사팀 표지: 무전기와 서류철을 겹친 작은 그림 (인물 사진을 쓰지 않는다) */
export function TeamIcon({ size = 38 }: { size?: number }) {
  return <img className="team-icon" src={teamRadio} alt="" width={size} height={Math.round(size * 1.25)} />;
}

/** 진행 중인 조사 한 줄: 막대와 남은 시간 (2026-10-17: 진행 조건을 없애 모든 조사의 도착 시각이 정해져 있다) */
function JobRow({ job, compact }: { job: TeamJob; compact: boolean }) {
  const now = useNow(true);
  const due = jobDueAt(job);
  const total = Math.max(1, due - job.startedAt);
  const pct = Math.min(100, Math.max(0, ((now - job.startedAt) / total) * 100));
  return (
    <div className={`job-bar ${compact ? 'compact' : ''}`}>
      <span className="job-label">{job.label}</span>
      <span className="job-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}><i style={{ width: `${pct}%` }} /></span>
      <span className="job-left">{clock(due - now)}</span>
    </div>
  );
}

/** 진행 중인 조사 목록 */
export function JobBar({ compact = false }: { compact?: boolean }) {
  const { state } = useGame();
  const jobs = state.team.jobs;
  if (!jobs.length) return compact ? null : <div className="job-bar idle"><span className="code">대기 중</span><span>요청을 받을 수 있습니다. 한 번에 세 건까지 맡길 수 있습니다.</span></div>;
  // 작은 표시에는 가장 먼저 끝나는 조사 하나를 보인다
  const shown = compact ? [...jobs].sort((a, b) => jobDueAt(a) - jobDueAt(b)).slice(0, 1) : jobs;
  return (
    <div className={`job-list ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
      {!compact && <span className="code job-list-hd">진행 중 {jobs.length} / {MAX_TEAM_JOBS}건</span>}
      {shown.map((j) => <JobRow key={j.id} job={j} compact={compact} />)}
      {compact && jobs.length > 1 && <span className="job-more">외 {jobs.length - 1}건 진행 중</span>}
    </div>
  );
}

/** 자료 표지: 모서리가 접힌 서류 한 장 (연필 선) */
export function DocIcon({ size = 14 }: { size?: number }) {
  return (
    <svg className="doc-icon" width={size} height={Math.round(size * 1.25)} viewBox="0 0 16 20" aria-hidden="true">
      <path d="M2.2 1.6 L10.6 1.4 L14 4.9 L13.8 18.4 L2.4 18.6 Z" fill="var(--paper)" stroke="var(--ink)" strokeWidth="1.1" strokeLinejoin="round" />
      <path d="M10.6 1.4 L10.4 5.1 L14 4.9" fill="none" stroke="var(--ink)" strokeWidth="0.9" strokeLinejoin="round" />
      <path d="M4.6 8.4 H11.6 M4.6 11.2 H11.4 M4.6 14 H9" fill="none" stroke="var(--ink)" strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

const drafts = { text: '' };

/** 수사팀 대화창. 자연어로 원본 조회·감정을 요청한다 */
export function TeamView() {
  const ctx = useGame();
  const { state, dispatch } = ctx;
  const msgs = state.team.chat;
  const [text, setTextRaw] = useState(drafts.text);
  const setText = (v: string) => { drafts.text = v; setTextRaw(v); };
  const busy = msgs.some((m) => m.status === 'pending');
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { dispatch({ type: 'teamRead' }); }, [msgs.length, dispatch]);
  useEffect(() => { bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' }); }, [msgs.length, busy]);

  const submit = () => {
    const t = text.trim().slice(0, MAX_TEAM_INPUT);
    if (!t || busy) return;
    setText('');
    void sendTeam(ctx, t);
  };

  return (
    <div className="person-view team-view">
      <div className="person-head">
        <TeamIcon size={52} />
        <div>
          <div style={{ font: '700 20px var(--doc)' }}>수사팀 <span className="muted" style={{ font: '13px var(--ui)' }}>원본 기록 조회 · 물건 감정 지원</span></div>
          <div className="muted" style={{ fontSize: 12.5 }}>요청을 받으면 바로 답하고, 결과는 조사가 끝나야 들어온다. 동시에 세 건까지 맡길 수 있다.</div>
        </div>
        <InkStamp style={{ marginLeft: 'auto' }}>지원팀</InkStamp>
      </div>
      <JobBar />
      <div className="chat team-chat">
        <div className="chat-body" ref={bodyRef}>
          {msgs.map((m) => <TeamMessage key={m.id} m={m} retryDisabled={busy} onRetry={() => void sendTeam(ctx, m.text, m.id)} />)}
          {busy && <Box className="msg them thinking" seed="team-thinking"><span className="code">수사팀이 요청을 확인하는 중…</span></Box>}
        </div>
        <div className="composer">
          <div className="row">
            <Box className="inputbox" seed="input-team">
              <textarea ref={inputRef} value={text} maxLength={MAX_TEAM_INPUT}
                // 근거 트레이의 자료는 용의자에게 내미는 것이다. 수사팀 입력칸에는 놓을 수 없다
                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = isTextDrag(e) ? 'copy' : 'none'; }}
                onDrop={(e) => { e.preventDefault(); if (isTextDrag(e)) setText(appendDropped(text, e.dataTransfer.getData('text/plain'), MAX_TEAM_INPUT)); }}
                placeholder={busy ? '수사팀이 확인하는 중… (다른 자료를 봐도 된다)' : `예) 부검 결과를 요청합니다 · 집무실 출입 기록을 보내 주세요`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Process')) sfx.key();
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
                }} />
              <PencilCaret target={inputRef} />
            </Box>
            <Box as="button" mode="double" className="btn" seed="send-team" onClick={submit} disabled={busy}>요청하기</Box>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocLinks({ ids }: { ids: string[] }) {
  const { state, dispatch } = useGame();
  const unseen = new Set(state.unseen);
  return (
    <div className="doc-links">
      {ids.filter((id) => state.owned.includes(id)).map((id) => (
        <Box as="button" key={id} seed={`dl${id}`} className="doc-link" onClick={() => dispatch({ type: 'openTab', tab: { type: 'doc', ref: id } })}>
          <DocIcon /> {docTitle(id)}{unseen.has(id) && <span className="badge-new">새 자료</span>}
        </Box>
      ))}
    </div>
  );
}

function TeamMessage({ m, onRetry, retryDisabled }: { m: ChatMsg; onRetry: () => void; retryDisabled: boolean }) {
  if (m.role === 'me') {
    return (
      <Box className={`msg me ${m.status ?? ''}`} seed={m.id}>
        <div className="who">수사관</div>
        <div>{m.text}</div>
        {m.status === 'failed' && (
          <div className="msg-failed" role="alert">
            <span>응답을 받지 못함{m.error ? ` · ${m.error}` : ''}</span>
            <button className="btn small" onClick={onRetry} disabled={retryDisabled}>다시 보내기</button>
          </div>
        )}
      </Box>
    );
  }
  if (m.kind === 'result') {
    return (
      <Box mode="double" className="msg them team-result" seed={m.id}>
        <div className="who">수사팀 · 결과 도착</div>
        <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
        {m.docs?.length ? <DocLinks ids={m.docs} /> : null}
      </Box>
    );
  }
  return (
    <Box className="msg them" seed={m.id}>
      <div className="who">수사팀</div>
      <div style={{ whiteSpace: 'pre-line' }}>{m.text}</div>
      {m.docs?.length ? <DocLinks ids={m.docs} /> : null}
    </Box>
  );
}

/**
 * 조사 결과 도착 알림. 어느 화면에 있든 오른쪽 위에 뜬다. 바로 읽기를 누르면 첫 자료를 연다.
 * 다른 창을 보고 있으면 브라우저 탭 제목에도 표시한다.
 */
/** 우상단 알림이 저절로 닫히기까지 */
export const NOTICE_MS = 60_000;

export function TeamNotice() {
  const { state, dispatch } = useGame();
  const n = state.notice;
  useEffect(() => {
    if (!n || !document.hidden) return;
    const base = document.title;
    let on = false;
    const id = window.setInterval(() => { on = !on; document.title = on ? '● 수사팀 결과 도착' : base; }, 1000);
    const stop = () => { window.clearInterval(id); document.title = base; };
    document.addEventListener('visibilitychange', stop, { once: true });
    return stop;
  }, [n]);
  // 1분이 지나면 저절로 닫는다
  useEffect(() => {
    if (!n) return;
    const id = window.setTimeout(() => dispatch({ type: 'notice', notice: null }), NOTICE_MS);
    return () => window.clearTimeout(id);
  }, [n, dispatch]);
  // 알린 새 자료를 모두 읽었으면 닫는다
  const allRead = !!n && n.docs.every((d) => !state.unseen.includes(d));
  useEffect(() => { if (allRead) dispatch({ type: 'notice', notice: null }); }, [allRead, dispatch]);
  if (!n || state.screen !== 'hub') return null;
  const close = () => dispatch({ type: 'notice', notice: null });
  return (
    <Box key={n.id} mode="double" className="team-notice card" seed={`notice${n.id}`} role="alert">
      <div className="tn-head"><TeamIcon size={26} /><span>수사팀 · 결과 도착</span><button className="x" title="닫기" onClick={close}><ArtIcon name="close" size={12} /></button></div>
      <div className="tn-title">{n.title}</div>
      <ul className="tn-docs">{n.docs.map((id) => <li key={id}><DocIcon size={12} /> {docTitle(id)}</li>)}</ul>
      <div className="tn-acts">
        <Box as="button" className="btn small" seed="tn-later" onClick={close}>나중에 읽기</Box>
        <Box as="button" mode="double" className="btn small" seed="tn-read" onClick={() => { dispatch({ type: 'openTab', tab: { type: 'doc', ref: n.docs[0] } }); dispatch({ type: 'teamRead' }); close(); }}>바로 읽기</Box>
      </div>
    </Box>
  );
}
