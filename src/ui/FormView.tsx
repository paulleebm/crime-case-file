import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { CASE_NO, FORM_LEAD, PERSONS, STATEMENTS, personOf } from '../data/case';
import { STATEMENT_FORMS } from '../data/statementForms';
import type { PersonId, Statement } from '../data/types';
import { paraShown } from '../engine/claims';
import { sanitizeStatement } from '../ai/statement';
import { hasClues, hasLiveClue, revisionSections } from '../engine/form';
import { nameOf, statementById } from '../engine/lookup';
import { clueRef } from '../data/clues';
import { useGame, type AiStatement, type StatementLine } from '../engine/state';
import { onStatementBusy, refreshStatement, statementBusy } from './conversation';
import { toTray } from './EvidenceTray';
import { Box, Seal } from '../sketch/components';
import { RichText } from './RichText';

const NUM = ['一', '二', '三', '四', '五', '六', '七'];

/**
 * 진술서. 항목마다 지금까지 받은 진술을 한 편의 본문으로 정리해 보여 준다.
 *  - 정정된 문장은 본문에서 빠지고, 정정으로 새로 한 말이 같은 항목 본문에 이어 붙는다.
 *  - 근거로 인정받은 사실은 진술인의 주장과 구분해 표시한다.
 *  - 이전 말·당시 제시한 근거·정정 순서는 항목의 "진술 이력"에 남긴다. 이력에는 플레이어가 실제로 받은 말만 있다.
 * 서로 다른 논점의 정정은 각자의 항목에 남으므로 어느 순서로 깨도 같은 본문이 된다.
 */
export function FormView({ person }: { person: PersonId }) {
  const ctx = useGame();
  const { state } = ctx;
  const ai = state.statements?.[person];
  const [, rerender] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onStatementBusy(rerender), []);
  // 진술서를 열었는데 대화에 비해 정리가 밀려 있으면(이전 저장, 정리 실패) 다시 정리한다
  useEffect(() => { void refreshStatement(ctx, person); }, [person]); // eslint-disable-line react-hooks/exhaustive-deps
  if (ai && ai.sections.length) return <AiFormView person={person} st={sanitizeStatement(ai, person, new Set(state.owned), ai.upto, ai.at)} busy={statementBusy(person)} />;
  return <RuleFormView person={person} busy={statementBusy(person)} />;
}

/** 진술서 머리 (사건 번호·인적 사항) */
function FormHead({ person }: { person: PersonId }) {
  const f = STATEMENT_FORMS[person];
  const p = PERSONS[person];
  return (
    <>
      <h2 className="form-title">진 술 서</h2>
      <table className="form-table">
        <tbody>
          <tr><th>사건 번호</th><td>{CASE_NO}</td></tr>
          <tr><th>작성 일시</th><td>{f.written}</td></tr>
          <tr><th>성명</th><td>{p.name} · {f.birth}</td></tr>
          <tr><th>직업</th><td>{f.job}</td></tr>
          <tr><th>주소 · 연락처</th><td>{f.address} · {f.phone}</td></tr>
          <tr><th>피해자와의 관계</th><td>{f.relation}</td></tr>
          <tr><th>작성 장소</th><td>{f.place}</td></tr>
        </tbody>
      </table>
      <div className="form-lead">{FORM_LEAD}</div>
    </>
  );
}

function FormSign({ person }: { person: PersonId }) {
  const f = STATEMENT_FORMS[person];
  const p = PERSONS[person];
  return (
    <div className="form-sign">
      <div>위 진술 내용은 사실과 다름없음을 확인하며, 자필로 서명합니다.</div>
      <div className="form-sign-row">
        <span>{f.written.slice(0, 13)}</span>
        <span>진술인 &nbsp; {p.name.split('').join(' ')}</span>
        <Seal text="인" size={34} />
      </div>
    </div>
  );
}

const BusyNote = () => <p className="form-busy">방금 대화를 진술서에 옮겨 적는 중…</p>;

/**
 * AI가 면담 대화를 읽고 정리한 진술서. 진술인이 실제로 한 말만 있다.
 * 앞서 한 말을 바꾼 문장에만 "정정"을 붙이고, 근거를 보고 처음 털어놓은 말은 "진술"로 붙인다.
 * 같은 내용의 근거 문장이 있는 줄은 눌러서 근거 트레이에 담을 수 있다.
 */
function AiFormView({ person, st, busy }: { person: PersonId; st: AiStatement; busy: boolean }) {
  const ctx = useGame();
  const { state } = ctx;
  const tray = new Set(state.tray ?? []);
  const owned = new Set(state.owned);
  const corrected = st.sections.reduce((n, s) => n + s.lines.filter((l) => l.kind === 'revised').length, 0);
  const marked = st.sections.some((s) => s.lines.some((l) => l.kind !== 'claim'));
  const line = (l: StatementLine, k: number) => {
    const cite = (l.cite ?? []).find((id) => owned.has(clueRef(id)) || owned.has(id));
    const inTray = !!cite && tray.has(cite);
    const cls = ['form-line', l.kind === 'fact' ? 'admitted' : '', cite && state.underline !== false ? 'clue collect' : '', inTray ? 'in-tray' : ''].join(' ');
    return (
      <p key={k} className={`form-ai ${l.kind}`}>
        {l.kind === 'revised' && <span className="addendum-tag">정정</span>}
        {l.kind === 'added' && <span className="addendum-tag">진술</span>}
        <span className={cls} title={cite ? (inTray ? '근거 트레이에 담겨 있다' : '눌러서 근거 트레이에 담기') : l.kind === 'fact' ? '근거를 보고 인정한 사실' : undefined}
          onClick={cite ? () => toTray(ctx, cite) : undefined}>{l.text}</span>
        {l.kind === 'revised' && l.was && <span className="form-was">앞서 한 말: <s>{l.was}</s></span>}
      </p>
    );
  };
  return (
    <div className="docview form-scroll">
      <Box mode="double" className="form-sheet sheet" seed={`form${person}`}>
        <FormHead person={person} />
        {marked && (
          <p className="form-empty-note">
            <span className="admitted">이렇게 표시한 문장</span>은 근거를 보고 인정한 사실이고, 나머지는 진술인의 주장이다.<br />
            {corrected > 0 ? `앞서 한 말을 바꾼 곳 ${corrected}군데에 ‘정정’을 붙였다.` : '앞서 한 말을 바꾼 곳은 아직 없다.'}
          </p>
        )}
        {st.sections.map((sec, i) => (
          <section key={i} className="form-sec">
            <h4>{NUM[i] ?? i + 1}. {sec.title}</h4>
            {sec.lines.map(line)}
          </section>
        ))}
        {busy && <BusyNote />}
        <FormSign person={person} />
      </Box>
    </div>
  );
}

/** 정해 둔 문장으로 만든 진술서 (AI 정리가 아직 없거나 닿지 못할 때) */
function RuleFormView({ person, busy }: { person: PersonId; busy: boolean }) {
  const { state } = useGame();
  const f = STATEMENT_FORMS[person];
  const p = PERSONS[person];
  const ownedSet = new Set(state.owned);
  const revisions = state.owned
    .map((id) => STATEMENTS.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => !!s && s.person === person && !s.initial);
  const struck = new Set(revisions.flatMap((s) => s.strikes ?? []));
  const admitted = new Set(revisions.flatMap((s) => s.admits ?? []));
  // 문단은 그 내용을 답으로 들었을 때만 채워진다
  const shown = (sec: (typeof f.sections)[number]) => sec.paras.filter((x) => paraShown(x, ownedSet));
  const any = f.sections.some((s) => shown(s).length > 0) || revisions.length > 0 || (state.memos?.[person]?.written.length ?? 0) > 0;
  const fresh = new Set(state.unseen);
  const placeOf = useMemo(() => revisionSections(person), [person]);
  const volunteered = new Set(state.volunteered ?? []);
  const order = new Map(revisions.filter((s) => !volunteered.has(s.id)).map((s, i) => [s.id, i + 1]));
  const [history, setHistory] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setHistory((h) => { const n = new Set(h); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const lastRef = useRef<HTMLElement>(null);
  const count = useRef(revisions.length);
  const latest = revisions[revisions.length - 1]?.id;
  // 새 정정 진술이 생기면 바뀐 항목으로 스크롤한다
  useEffect(() => {
    if (revisions.length > count.current) lastRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    count.current = revisions.length;
  }, [revisions.length]);

  /** 정정 당시 받아들여진 근거 이름 (자기 앞선 인정은 한 번만) */
  const basisOf = (s: Statement) => {
    const ids = state.basis?.[s.id] ?? [];
    const names = ids.map((id) => (statementById.has(id) && personOf(id) === person ? `${p.name}의 앞선 인정` : nameOf(id)));
    return [...new Set(names)];
  };

  const section = (i: number, title: string, paras: { text: string }[], place = i) => {
    const revs = revisions.filter((s) => (placeOf.get(s.id) ?? -1) === place);
    // 아직 아무 진술도 없는 항목은 제목도 쓰지 않는다 (제목이 앞으로 나올 이야기를 알려 주지 않게)
    if (!paras.length && !revs.length) return null;
    const open = history.has(i);
    // 지금의 진술: 정정되지 않은 원래 문단 + 정정으로 새로 한 말 가운데 아직 유효한 문장
    const nowParas = paras.filter((x) => !hasClues(x.text) || hasLiveClue(x.text, struck));
    const nowRevs = revs.filter((s) => hasLiveClue(s.text, struck));
    const isFresh = revs.some((s) => fresh.has(s.id));
    const corrections = revs.filter((s) => !volunteered.has(s.id));
    const freshTag = revs.some((s) => fresh.has(s.id) && !volunteered.has(s.id)) ? '진술 수정됨' : isFresh ? '새 진술' : '';
    return (
      <section key={i} className={`form-sec ${isFresh ? 'fresh' : ''}`} ref={revs.some((s) => s.id === latest) ? lastRef : undefined}>
        <h4>
          {NUM[numberOf(place)] ?? numberOf(place) + 1}. {title}
          {freshTag && <span className="addendum-tag">{freshTag}</span>}
          {revs.length > 0 && <button className="form-history" onClick={() => toggle(i)}>{open ? '진술 이력 닫기' : corrections.length ? `진술 이력 · 정정 ${corrections.length}회` : '진술 이력'}</button>}
        </h4>
        {nowParas.length || nowRevs.length
          ? <>
              {nowParas.map((para, k) => <p key={k}><RichText text={para.text} struck={struck} current admitted={admitted} /></p>)}
              {nowRevs.length > 0 && (
                <p className="form-now">
                  {nowRevs.map((s, k) => <span key={s.id}>{k ? ' ' : ''}<RichText text={s.text.replace(/^…\s*/, '')} struck={struck} current admitted={admitted} /></span>)}
                </p>
              )}
            </>
          : <div className="form-blank"><i /><i /></div>}
        {open && (
          <div className="form-history-panel">
            {paras.length > 0 && (
              <div className="hist-entry">
                <div className="hist-hd">처음 진술</div>
                {paras.map((para, k) => <p key={k}><RichText text={para.text} struck={struck} /></p>)}
              </div>
            )}
            {revs.map((s) => {
              const basis = basisOf(s);
              return (
                <div key={s.id} className="hist-entry">
                  <div className="hist-hd">
                    <Seal text={volunteered.has(s.id) ? '진술' : '정정'} size={22} />
                    <span>{volunteered.has(s.id) ? '근거를 보고 털어놓음' : `정정 ${order.get(s.id)}`}</span>
                    {basis.length > 0 && <span className="hist-basis">제시한 근거: {basis.join(', ')}</span>}
                  </div>
                  <p><RichText text={s.text} struck={struck} /></p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };
  const extra = revisions.some((s) => (placeOf.get(s.id) ?? -1) < 0);
  // 채워진 항목만 차례로 번호를 붙인다
  const filled = f.sections.map((_, i) => i).filter((i) => shown(f.sections[i]).length > 0 || revisions.some((r) => placeOf.get(r.id) === i));
  function numberOf(place: number) { return place < 0 ? filled.length : filled.indexOf(place); }
  // AI가 정해 둔 답 밖에서 직접 한 답 (사건에 관한 말). 근거로 쓰지는 않는다
  const written = (state.memos?.[person]?.written ?? []).filter((w) => w.a.trim() && !w.casual);

  return (
    <div className="docview form-scroll">
      <Box mode="double" className="form-sheet sheet" seed={`form${person}`}>
        <FormHead person={person} />
        {!any && <p className="form-empty-note">아직 받은 진술이 없다. 질문한 주제의 관련 진술이 해당 항목에 정리된다.</p>}
        {revisions.length > 0 && (
          <p className="form-empty-note">
            항목마다 지금의 진술을 정리했다. <span className="admitted">이렇게 표시한 문장</span>은 근거로 인정받은 사실이고, 나머지는 진술인의 주장이다. 이전 말과 그때 제시한 근거는 항목의 ‘진술 이력’에 있다.
          </p>
        )}
        {f.sections.map((s, i) => section(i, s.title, shown(s)))}
        {extra && section(f.sections.length, '심문 중 추가 진술', [], -1)}
        {written.length > 0 && (
          <section className="form-sec">
            <h4>{NUM[filled.length + (extra ? 1 : 0)] ?? filled.length + 1}. 그 밖의 진술</h4>
            {written.map((w, k) => <p key={k} className="form-written"><span className="muted">문 · {w.q}</span><br />답 · {w.a}</p>)}
          </section>
        )}

        {busy && <BusyNote />}
        <FormSign person={person} />
      </Box>
    </div>
  );
}
