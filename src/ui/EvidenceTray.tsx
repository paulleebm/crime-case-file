import { type DragEvent } from 'react';
import { CITED_FACTS } from '../ai/interpret';
import { clueRe, clueRef, plain } from '../data/clues';
import { EVIDENCE, PERSONS, STATEMENTS, personOf } from '../data/case';
import { STATEMENT_FORMS } from '../data/statementForms';
import type { Block, PersonId } from '../data/types';
import { factsOfClue, sourceId, visibleClaims } from '../engine/claims';
import { evidenceById, factById, statementById } from '../engine/lookup';
import { MAX_ATTACH, useGame, type GameCtx } from '../engine/state';
import { Box } from '../sketch/components';
import { HoverTip } from './HoverTip';
import { ArtIcon } from './ArtIcon';

// 근거 트레이와 근거 제시.
// 1. 자료·진술서·대화의 밑줄 친 문장을 누르면 근거 트레이(왼쪽 아래)에 담긴다. 밑줄이 없는 답은 말풍선의 단추로 담는다.
// 2. 트레이의 근거를 심문 대화창으로 끌어다 놓으면 다음 말에 첨부된다.
// 3. ‘근거 제시’를 누르면, 그 근거가 무너뜨리는 이 사람의 숨긴 이야기를 찾아 판정한다 (어느 말인지 고르지 않는다).

const short = (t: string, n = 26) => { const x = plain(t).replace(/\s+/g, ' ').trim(); return x.length > n ? `${x.slice(0, n)}…` : x; };

const blockTexts = (b: Block): string[] =>
  b.type === 'p' || b.type === 'h' ? [b.text] : b.type === 'table' ? b.rows.flat() : b.type === 'log' ? b.lines : b.type === 'cuts' ? b.cuts.map((c) => c.text) : [];

/** 근거 문장 ID(A-01.3, E-16.2) → 글. 자료 본문·진술서 양식·진술·답변에 적힌 것 전부 */
const CLUE_TEXT = new Map<string, string>(
  [
    ...EVIDENCE.flatMap((e) => e.body.flatMap(blockTexts)),
    ...Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((sec) => sec.paras.map((x) => x.text))),
    ...STATEMENTS.map((x) => x.text),
    ...[...factById.values()].flatMap((f) => [f.answer, ...(f.alt ?? [])]),
  ].flatMap((t) => [...t.matchAll(clueRe())].map((m) => [m[1], m[2]] as [string, string])),
);

/** 트레이·칩·말풍선에 보여 줄 이름 */
export function attachLabel(id: string, person?: PersonId, n = 22): string {
  const ev = evidenceById.get(id);
  if (ev) return ev.title;
  const clue = CLUE_TEXT.get(id);
  const docOf = evidenceById.get(clueRef(id));
  if (docOf) return `${docOf.title}: “${short(clue ?? '', n - 6)}”`;
  const who = personOf(id);
  if (!who) return id;
  const st = statementById.get(id);
  const f = factById.get(id);
  const text = clue ?? (st ? st.say ?? st.text : f ? f.answer : '');
  return who === person ? `“${short(text, n)}”` : `${PERSONS[who].name}: “${short(text, n - 4)}”`;
}

/** 마우스를 올렸을 때 보여 줄 전체 글: 어디서 나온 근거인지와 그 문장 전체 */
export function fullTip(id: string) {
  const ev = evidenceById.get(id);
  if (ev) return <><b>{ev.title}</b><div>{plain(ev.summary)}</div></>;
  const clue = CLUE_TEXT.get(id);
  const docOf = evidenceById.get(clueRef(id));
  if (docOf) return <><b>{docOf.title}</b><div>{plain(clue ?? '')}</div></>;
  const who = personOf(id);
  const st = statementById.get(id);
  const f = factById.get(id);
  const text = clue ?? (st ? st.text : f ? f.answer : id);
  return <><b>{who ? `${PERSONS[who].name}의 말` : id}</b><div>{plain(text)}</div></>;
}

/** 이 사람에게서 지금 맞댈 수 있는 말 (정정되지 않은 것, 같은 말은 한 번) */
export function liveClaims(person: PersonId, owned: Set<string>) {
  const live = visibleClaims(person, owned).filter((c) => !c.struck);
  // 진술서 문장으로 정리된 답은 진술서 문장 하나로만 보인다 (같은 말이 두 번 뜨지 않게)
  const covered = new Set(live.flatMap((c) => factsOfClue(c.id, owned)));
  const seen = new Set<string>();
  return live.filter((c) => !covered.has(c.id)).filter((c) => { const k = short(c.text, 14); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** 아직 정정되지 않은, 맞댈 수 있는 이 사람의 말인가 (목록에서 같은 말로 합쳐진 답도 포함) */
export const isLiveClaim = (person: PersonId, owned: Set<string>, id: string) => visibleClaims(person, owned).some((c) => c.id === id && !c.struck);

/** 대화창에 끌어다 놓은 것을 다음 말에 근거로 첨부한다 (그 사람 자신의 말은 근거가 되지 않는다) */
export function dropOnChat(ctx: GameCtx, person: PersonId, id: string) {
  const owned = new Set(ctx.getState().owned);
  if (personOf(id) === person && !statementById.has(sourceId(id))) return;
  if (owned.has(sourceId(id))) ctx.dispatch({ type: 'attach', person, id });
}

/** 근거로 쓸 수 있는 답: 기록되는 답, 또는 어떤 지적의 근거가 되는 답 */
export function collectable(factIds: string[], owned: Set<string>): string[] {
  return factIds.filter((id) => owned.has(id) && (factById.get(id)?.record || CITED_FACTS.has(id)));
}

/** 트레이에 담는다 (이미 있으면 그대로) */
export function toTray(ctx: Pick<GameCtx, 'dispatch' | 'getState'>, id: string) {
  if ((ctx.getState().tray ?? []).includes(id)) return;
  ctx.dispatch({ type: 'trayAdd', id });
  ctx.dispatch({ type: 'toast', text: `근거 트레이에 담았다: ${attachLabel(id, undefined, 30)}` });
}

const DRAG_TYPE = 'application/x-evidence';
export const readDrop = (e: DragEvent) => e.dataTransfer.getData(DRAG_TYPE) || null;
export const isEvidenceDrag = (e: DragEvent) => e.dataTransfer.types.includes(DRAG_TYPE);
/** 메모장 등에서 끌어 온 글 (근거가 아닌 그냥 글) */
export const isTextDrag = (e: DragEvent) => !isEvidenceDrag(e) && e.dataTransfer.types.includes('text/plain');
/** 끌어 온 글을 입력칸 글 뒤에 붙인다 */
export const appendDropped = (cur: string, add: string, max: number) => {
  const t = add.trim();
  if (!t) return cur;
  return (cur && !/\s$/.test(cur) ? `${cur} ${t}` : cur + t).slice(0, max);
};

/** 왼쪽 패널의 근거 트레이 */
export function TraySection() {
  const { state, dispatch } = useGame();
  const items = state.tray ?? [];
  return (
    <>
      <div className="sec"><ArtIcon name="tray" size={18} /> 근거 트레이 {items.length > 0 && <span className="muted">{items.length}</span>}</div>
      <div className="tray-list">
        {items.length === 0 && <div className="tray-empty">자료·진술서·대화의 밑줄 친 문장을 누르면 여기에 모인다.{'\n'}심문 대화창으로 끌어다 놓아 첨부한다.</div>}
        {items.map((id) => (
          <div key={id} className="tray-row tray-item" draggable="true"
            onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, id); e.dataTransfer.setData('text/plain', attachLabel(id)); e.dataTransfer.effectAllowed = 'copy'; }}>
            <span className="tray-grip" aria-hidden>⠿</span>
            <HoverTip className="tray-text" tip={fullTip(id)}>{attachLabel(id, undefined, 30)}</HoverTip>
            <button className="x" title="트레이에서 빼기" onClick={() => dispatch({ type: 'trayRemove', id })}>✕</button>
          </div>
        ))}
      </div>
    </>
  );
}

/** 입력란 위: 첨부한 근거 */
export function DraftBar({ person }: { person: PersonId }) {
  const { state, dispatch } = useGame();
  const draft = state.drafts?.[person] ?? { evidence: [] };
  if (!draft.evidence.length) return null;
  return (
    <div className="draft-bar">
      <div className="pressed">
        <span className="code">첨부한 근거</span>
        {draft.evidence.map((id) => (
          <Box as="span" key={id} seed={`att${id}`} className="pressed-chip">
            <HoverTip tip={fullTip(id)}>{attachLabel(id, person)}</HoverTip>
            <button className="x" title="첨부 빼기" onClick={() => dispatch({ type: 'detach', person, id })}>✕</button>
          </Box>
        ))}
        {draft.evidence.length >= MAX_ATTACH && <span className="muted">(한 번에 {MAX_ATTACH}개까지)</span>}
      </div>
    </div>
  );
}
