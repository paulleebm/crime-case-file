import { useLayoutEffect, useRef, useState } from 'react';
import { gradeAnswers, MAX_ANSWER } from '../ai/grade';
import { CASE_TITLE, NO_CULPRIT, PERSONS, isNoCulprit, questionsFor } from '../data/case';
import type { PersonId } from '../data/types';
import { grade } from '../engine/logic';
import { useGame, type ReportDraft, type ReportResult } from '../engine/state';
import { Box, Portrait, RedMark } from '../sketch/components';
import { PencilCaret } from './PencilCaret';

const MARK = { correct: 'circle', partial: 'triangle', wrong: 'cross' } as const;
const VERDICT = { correct: '정답', partial: '세모 · 부분 정답', wrong: '오답' } as const;

/**
 * 서술형 답 입력칸. textarea 는 브라우저 커서를 숨기므로 연필 커서를 함께 그린다.
 * 기본 높이는 네댓 줄이고, 그보다 길게 쓰면 내용만큼 늘어난다. 글자 수는 한도에 닿았을 때만 알린다.
 */
function AnswerInput({ id, value, onChange }: { id: string; value: string; onChange: (text: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <Box className="inputbox report-input" seed={`ri-${id}`}>
      <textarea ref={ref} value={value} maxLength={MAX_ANSWER} rows={4} placeholder="알아낸 것을 내 말로 쓴다" onChange={(e) => onChange(e.target.value)} />
      <PencilCaret target={ref} />
      {value.length >= MAX_ANSWER && <div className="report-count full">{MAX_ANSWER}자까지 쓸 수 있다.</div>}
    </Box>
  );
}

/**
 * 사건 재구성 본문. 1번 범인은 고르고, 나머지는 범행을 육하원칙으로 묻는 서술형이다.
 * graded가 있으면 읽기 전용으로 빨간 연필 채점과 채점관의 한 줄, 모범 답을 보여 준다.
 */
export function ReportSheet({ draft, graded, onChange }: { draft: ReportDraft; graded?: ReportResult; onChange?: (patch: Partial<ReportDraft>) => void }) {
  const ro = !!graded || !onChange;
  return (
    <div className="report-sheet">
      <h3 className="doc-title" style={{ textAlign: 'center', letterSpacing: '.4em' }}>사 건 재 구 성</h3>
      <div className="doc-meta" style={{ textAlign: 'center' }}>{CASE_TITLE}</div>

      <Box className="report-q card" seed="rq-culprit">
        <h4 className="q-title">
          <span className="q-num">1{graded && <RedMark kind={graded.culpritOk ? 'circle' : 'cross'} seed="n-culprit" />}</span>
          <span className="q-w">누가</span>범인은 누구인가?
        </h4>
        <div className="choices">
          {(Object.keys(PERSONS) as PersonId[]).map((p) => {
            const chosen = draft.culprit === p;
            return (
              <Box as="button" key={p} className={`choice ${chosen ? 'on' : ''}`} mode={chosen ? 'double' : 'single'} seed={`cul${p}${chosen}`}
                disabled={ro} onClick={() => onChange?.({ culprit: p })} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Portrait person={p} w={30} h={36} />{PERSONS[p].name}
                {graded && chosen && !graded.culpritOk && <RedMark kind="strike" seed={`s-cul-${p}`} />}
              </Box>
            );
          })}
          {(Object.keys(NO_CULPRIT) as (keyof typeof NO_CULPRIT)[]).map((k) => {
            const chosen = draft.culprit === k;
            return (
              <Box as="button" key={k} className={`choice ${chosen ? 'on' : ''}`} mode={chosen ? 'double' : 'single'} seed={`cul${k}${chosen}`}
                disabled={ro} onClick={() => onChange?.({ culprit: k })}>
                {NO_CULPRIT[k]}
                {graded && chosen && !graded.culpritOk && <RedMark kind="strike" seed={`s-cul-${k}`} />}
              </Box>
            );
          })}
        </div>
      </Box>

      {questionsFor(draft.culprit).map((q, i) => {
        const v = graded?.verdicts?.[q.id] ?? (graded ? (graded.correct[q.id] ? 'correct' : 'wrong') : undefined);
        const answer = draft.answers[q.id] ?? '';
        return (
          <Box key={q.id} className="report-q card" seed={`rq-${q.id}`}>
            <h4 className="q-title">
              <span className="q-num">{i + 2}{v && <RedMark kind={MARK[v]} seed={`n-${q.id}`} />}</span>
              <span className="q-w">{q.w}</span>{q.q}
            </h4>
            {!ro && q.guide && <div className="report-guide">{q.guide}</div>}
            {ro
              ? <div className="report-answer">{answer.trim() || <span className="muted">(쓰지 않음)</span>}</div>
              : (
                <AnswerInput id={q.id} value={answer} onChange={(text) => onChange?.({ answers: { [q.id]: text } })} />
              )}
            {graded && v && (
              <div className="report-grade">
                <div><b>{VERDICT[v]}</b>{graded.comments?.[q.id] ? ` · ${graded.comments[q.id]}` : ''}</div>
                {'model' in q && <div className="report-model">모범 답: {String(q.model)}</div>}
              </div>
            )}
          </Box>
        );
      })}
    </div>
  );
}

export function ReportView() {
  const { state, dispatch } = useGame();
  const [confirm, setConfirm] = useState(false);
  const [grading, setGrading] = useState(false);
  const d = state.report;

  if (state.result) {
    return (
      <div className="reportview">
        <ReportSheet draft={d} graded={state.result} />
        {state.result.local && <div className="report-rule muted">채점관에 닿지 못해 낱말로 채점했다.</div>}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 10 }}>
          <Box as="button" className="btn" seed="to-result" onClick={() => dispatch({ type: 'screen', screen: 'result' })}>결과 보기</Box>
        </div>
      </div>
    );
  }

  const empty = questionsFor(d.culprit).filter((q) => !(d.answers[q.id] ?? '').trim()).length;
  const submit = async () => {
    setGrading(true);
    const marks = isNoCulprit(d.culprit) ? undefined : await gradeAnswers(d.answers);
    setGrading(false);
    setConfirm(false);
    dispatch({ type: 'result', result: grade(d, marks) });
  };

  return (
    <div className="reportview">
      <Box mode="dash" className="report-rule" seed="report-rule">
        범인을 고르고, 그날 밤의 범행을 육하원칙에 따라 글로 정리한다.<br />
        길게 쓸 필요는 없다.<br />
        문항마다 무엇을 쓰면 되는지 적어 두었다. <b>그 핵심을 담으면 정답</b>이다.<br />
        정확한 용어나 분 단위 시각까지 맞힐 필요는 없다.<br />
        핵심이 일부만 맞거나 흐릿하면 세모(부분 정답)를 받는다.<br />
        언제든 다시 와서 쓰고 고칠 수 있다. 쓴 내용은 저장된다.<br />
        <b>‘사건 해결’을 누르면 모든 답을 한 번에 채점하고 수사가 끝난다.</b> 확신이 설 때까지 수사를 계속해도 된다.
      </Box>
      <ReportSheet draft={d} onChange={(nd) => dispatch({ type: 'report', patch: nd })} />
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Box as="button" mode="double" className="btn" seed="solve" disabled={!d.culprit} title={d.culprit ? undefined : '범인을 먼저 고른다'} onClick={() => setConfirm(true)}>사건 해결</Box>
      </div>

      {confirm && (
        <div className="modal-back" role="dialog" aria-modal="true" onClick={() => !grading && setConfirm(false)}>
          <Box mode="double" className="modal card" seed="solve-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="modal-title">결론을 제출한다</h3>
            <p>기회는 한 번뿐이다.<br />제출하면 모든 답을 한 번에 채점하고 수사가 끝난다. 다시 고칠 수 없다.</p>
            <p>{culpritLabel(d.culprit!)}{empty > 0 && <><br />쓰지 않은 문항 {empty}개는 오답이 된다.</>}</p>
            <div className="modal-acts">
              <Box as="button" className="btn" seed="solve-back" disabled={grading} onClick={() => setConfirm(false)}>계속 수사</Box>
              <Box as="button" mode="double" className="btn" seed="solve-go" disabled={grading} onClick={() => void submit()}>{grading ? '채점 중…' : '제출'}</Box>
            </div>
          </Box>
        </div>
      )}
    </div>
  );
}

/** 제출 확인창에 보일 1번 답 */
function culpritLabel(c: NonNullable<ReportDraft['culprit']>) {
  return isNoCulprit(c) ? <>결론: <b>{NO_CULPRIT[c]}</b></> : <>지목한 범인: <b>{PERSONS[c].name}</b></>;
}
