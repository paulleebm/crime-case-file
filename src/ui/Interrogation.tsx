import { useEffect, useRef, useState } from 'react';
import { sfx } from '../audio/sfx';
import { MAX_TALK_INPUT as MAX_INPUT } from '../ai/talk';
import { PERSONS } from '../data/case';
import type { PersonId } from '../data/types';
import { useGame, type ChatMsg } from '../engine/state';
import { Box } from '../sketch/components';
import { send } from './conversation';
import { PencilCaret } from './PencilCaret';
import { plain } from '../data/clues';
import { DraftBar, appendDropped, attachLabel, dropOnChat, fullTip, isEvidenceDrag, isTextDrag, readDrop } from './EvidenceTray';
import { HoverTip } from './HoverTip';
import { josa } from '../engine/josa';

/** 입력하던 말은 인물을 옮겨도 남긴다 (사람별) */
const drafts = new Map<PersonId, string>();

/** 심문 대화창. 근거 트레이에서 끌어 온 근거를 상대의 말 하나에 맞대어 내민다 */
export function Interrogation({ person }: { person: PersonId }) {
  const ctx = useGame();
  const { state, dispatch } = ctx;
  const p = PERSONS[person];
  const [text, setTextRaw] = useState(() => drafts.get(person) ?? '');
  const setText = (v: string) => { drafts.set(person, v); setTextRaw(v); };
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const msgs = state.chats[person];
  // 응답을 기다리는 말이 있으면 답하는 중이다 (상태에 남으므로 다른 화면에 다녀와도 그대로 보인다)
  const busy = msgs.some((m) => m.status === 'pending');
  const [over, setOver] = useState(false);
  const draft = state.drafts?.[person] ?? { evidence: [] };
  const presenting = draft.evidence.length > 0;

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs.length, busy]);

  // 한 번 누름이 두 번 보내지지 않게 (누름 처리와 click이 함께 오는 경우)
  const sentAt = useRef(0);
  function fire() {
    const now = Date.now();
    if (now - sentAt.current < 600) return;
    sentAt.current = now;
    submit();
  }

  function submit() {
    const t = text.trim().slice(0, MAX_INPUT);
    if ((!t && !presenting) || busy) return;
    setText('');
    // 첨부한 근거는 이 말과 함께 내밀고 비운다
    if (presenting) dispatch({ type: 'detach', person });
    void send(ctx, person, t, undefined, presenting ? { evidence: draft.evidence } : undefined);
  }

  return (
    <div className="chat">
      <div className="chat-body" ref={bodyRef}>
        {msgs.map((m) => <Message key={m.id} m={m} person={person} onRetry={() => void send(ctx, person, m.text, m.id, m.attached?.length ? { evidence: m.attached, ...(m.pin ? { pin: m.pin } : {}) } : undefined)} retryDisabled={busy} />)}
        {busy && (
          <Box className="msg them thinking" seed="thinking" aria-label={`${josa(p.name, '이/가')} 답하는 중`}>
            <InkDots />
          </Box>
        )}
      </div>
      <div className={`composer ${over ? 'drag' : ''}`}
        onDragOver={(e) => { if (isEvidenceDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(true); } else if (isTextDrag(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
        onDrop={(e) => {
          const id = readDrop(e); setOver(false);
          if (id) { e.preventDefault(); dropOnChat(ctx, person, id); return; }
          // 메모장에서 끌어 온 글은 입력칸에 붙인다
          if (isTextDrag(e)) { e.preventDefault(); setText(appendDropped(text, e.dataTransfer.getData('text/plain'), MAX_INPUT)); inputRef.current?.focus(); }
        }}>
        {over && <div className="drop-hint">여기에 놓으면 첨부된다</div>}
        <DraftBar person={person} />
        <div className="row">
          <Box className="inputbox" seed={`input${person}`}>
            <textarea
              ref={inputRef}
              value={text}
              placeholder={busy ? `${p.name}의 답을 기다리는 중… (다른 자료를 봐도 된다)` : presenting ? '덧붙일 말 (비워도 된다)' : `${p.name}에게 질문하기 · 근거는 트레이에서 끌어다 놓는다`}
              maxLength={MAX_INPUT}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // 자판을 누를 때마다 타자 소리 (조합 중인 한글 입력도 포함, 기능키·반복 입력은 뺀다)
                if (!e.repeat && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Process')) sfx.key();
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  submit();
                }
              }}
            />
            <PencilCaret target={inputRef} />
          </Box>
          {/* 2026-10-15 플레이 리뷰: 근거 넷을 첨부한 뒤 버튼을 눌렀는데 보내지지 않았다(Enter는 됐다).
              누르는 순간 입력란이 포커스를 잃으며 화면이 다시 배치되면, 누른 곳과 뗀 곳이 달라져 click이 생기지 않을 수 있다.
              포커스를 입력란에 그대로 두고, 누른 포인터를 버튼이 붙잡아 뗄 때 보낸다. 키보드로 누르는 경우는 click이 맡는다 */}
          <Box as="button" mode="double" className="btn" seed={`send${presenting}`} disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={(e) => { if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId); }}
            onPointerUp={(e) => {
              const el = e.currentTarget;
              if (!el.hasPointerCapture(e.pointerId)) return;
              el.releasePointerCapture(e.pointerId);
              // 버튼 밖으로 멀리 끌고 나가 뗐으면 누르기를 취소한 것이다 (조금 밀린 정도는 보낸다)
              const r = el.getBoundingClientRect(), pad = 24;
              if (e.clientX >= r.left - pad && e.clientX <= r.right + pad && e.clientY >= r.top - pad && e.clientY <= r.bottom + pad) fire();
            }}
            onClick={fire}
            title={presenting ? '첨부한 근거를 내민다' : undefined}>{presenting ? '근거 제시' : '말하기'}</Box>
        </div>
      </div>
    </div>
  );
}

function Message({ m, person, onRetry, retryDisabled }: { m: ChatMsg; person: PersonId; onRetry: () => void; retryDisabled: boolean }) {
  if (m.role === 'note' && m.hint) {
    return (
      <Box className="record hint" seed={m.id}>
        <div className="who">수사 수첩</div>
        <div>{m.text}</div>
      </Box>
    );
  }
  if (m.role === 'note') {
    return (
      <Box mode="double" className="record" seed={m.id}>
        {m.text}
        {m.sub && <div className="record-sub">{m.sub}</div>}
      </Box>
    );
  }
  if (m.role === 'me') {
    return (
      <Box className={`msg me ${m.status ?? ''}`} seed={m.id}>
        <div className="who">수사관</div>
        <div>{m.text}</div>
        {m.attached?.length ? (
          <div className="msg-attached">
            {m.pin && <HoverTip className="att pin" tip={fullTip(m.pin)}>짚은 말 {attachLabel(m.pin, person, 30)}</HoverTip>}
            {m.attached.map((id) => <HoverTip key={id} className="att" tip={fullTip(id)}>📎 {attachLabel(id, person)}</HoverTip>)}
          </div>
        ) : null}
        {m.status === 'failed' && (
          <div className="msg-failed" role="alert">
            <span>응답을 받지 못함{m.error ? ` · ${m.error}` : ''}</span>
            <button className="btn small" onClick={onRetry} disabled={retryDisabled}>다시 보내기</button>
          </div>
        )}
      </Box>
    );
  }
  const parts = m.parts ?? [{ text: m.text }];
  return (
    <Box className="msg them" seed={m.id}>
      <div className="who">{PERSONS[person].name}{m.record ? (m.volunteer ? ' · 진술' : ' · 진술 정정') : ''}</div>
      {parts.map((pt, i) => (
        <div key={i} style={{ marginTop: i ? 10 : 0 }}>{plain(pt.text)}</div>
      ))}
    </Box>
  );
}

/**
 * 연필로 그린 작은 동그라미 세 개. 모양이 조금씩 찌그러지고, 끝이 시작점을 지나쳐 바깥으로 빠진다.
 * 흐린 덧선을 한 번 더 겹쳐 연필로 두 번 돌린 느낌을 낸다. 하나씩 나타나 셋이 된 뒤 모두 사라지기를 되풀이한다.
 */
const PENCIL: [string, string][] = [
  ['M6.8 2.5C5.2 1.9 3.2 2.6 2.5 4.3 1.8 6 2.6 8.1 4.4 8.7 6.2 9.3 8.2 8.4 8.7 6.6 9.1 5 8.3 3.4 6.7 2.8 6.1 2.6 5.3 2.7 4.8 3.1', 'M5.4 2.4C3.7 2.3 2.3 3.9 2.4 5.7 2.5 7.5 4.1 8.9 5.9 8.6'],
  ['M4.2 2.8C5.7 2 7.7 2.5 8.5 4 9.3 5.6 8.6 7.7 6.9 8.5 5.2 9.2 3.1 8.5 2.4 6.8 1.8 5.2 2.4 3.7 4 3 4.7 2.7 5.6 2.6 6.4 2.9', 'M8.4 4.4C8.3 6.4 6.6 8.6 4.6 8.5 3.2 8.4 2.2 7.2 2.3 5.8'],
  ['M7.3 3C6 1.9 3.9 2.1 2.9 3.4 1.9 4.8 2.1 7 3.6 8.1 5.1 9.2 7.4 8.8 8.4 7.3 9.3 5.9 9 3.9 7.6 3.1 6.9 2.7 6 2.6 5.2 2.9', 'M3.2 3.6C2 5.1 2.3 7.4 3.9 8.3 5.4 9.1 7.6 8.6 8.4 7.2'],
];
function InkDots() {
  return (
    <span className="ink-dots" aria-hidden>
      {PENCIL.map(([main, retrace], i) => (
        <svg key={i} viewBox="0 0 11 11" className={`ink-dot d${i + 1}`}>
          <g><path className="line" d={main} /><path className="retrace" d={retrace} /></g>
        </svg>
      ))}
    </span>
  );
}
