import { AFTERWORD, CONFESSION, PERSONS } from '../data/case';
import { useGame, type CulpritChoice } from '../engine/state';
import { Box, Portrait, Seal } from '../sketch/components';
import { ReportSheet } from './Report';

export { Epilogue } from './TruthSlides';

const HOTEL_GRADE: Record<string, { title: string; seal: string; text: string }> = {
  perfect: { title: '해결', seal: '해결', text: '흉기는 9시 10분 문자보다 먼저 집무실을 떠나 매입점에 보관되어 있었다.\n늦게 도착한 문자는 예약된 것이었고, 그 문자를 등록할 수 있었던 사람은 집무실에 남아 있던 한 사람뿐이었다.\n민아의 심부름과 준서의 매각이 오히려 범행 시각을 밝혀 주었다.' },
  solved: { title: '해결', seal: '확인', text: '문태준을 지목하고 사건의 큰 흐름을 설명했다.\n다만 범행의 몇 가지는 끝내 정확히 짚지 못했다.' },
  insufficient: { title: '미해결', seal: '미해결', text: '문태준을 지목했지만 그날 저녁을 설명하지 못했다.\n언제, 무엇으로, 범행 뒤 무엇을, 왜 했는지 절반도 맞추지 못한 결론은 법정에서 버티지 못한다.\n흉기가 언제 집무실을 떠났는지, 문자가 언제 등록됐는지 다시 살펴보자.' },
  wrong: { title: '오인', seal: '오인', text: '' },
};

const HOTEL_WRONG: Record<CulpritChoice, string> = {
  A: '류준서는 문자에 화가 나 올라갔고, 아버지의 유언 정리에 겁을 먹고 있었다.\n하지만 준서는 8시 20분부터 9시 15분까지 매입점에 있었고, 트로피를 손으로 만지지도 않았다.\n흉기는 9시 10분보다 먼저 매입점에 들어가 계속 보관되었다.',
  B: '서민아는 계약 종료 결재로 회장에게 서운해하고 있었고, 흉기를 들고 집무실을 나왔으며, 흉기에는 그녀의 지문만 남아 있었다.\n하지만 그녀는 8시 47분에 이미 매입점에 있었다. 8시 48분에 문자가 예약될 때 집무실에 있을 수 없었다.\n8시 50분에 집무실 문을 열고 나간 사람은 따로 있었고, 그녀가 들어갔을 때 그 사람은 화장실 안에 숨어 있었다.',
  C: '',
  suicide: '회장이 스스로 목숨을 끊었다고 보기에는 상처가 뒤통수에 있었다.\n누군가 쓰러진 회장을 화장실로 옮기고 피를 닦았으며, 트로피도 닦아 제자리에 올려 두었다.\n8시 48분에 회장의 휴대폰으로 9시 10분 문자를 예약한 사람도 따로 있었다.',
  accident: '넘어져 다친 사고로 보기에는 쓰러진 자리와 발견된 자리가 달랐다.\n누군가 회장을 화장실로 옮기고 바닥과 트로피를 닦았다.\n사고였다면 그 흔적을 지울 사람도, 9시 10분 문자를 예약할 사람도 없었다.',
};

const GRADE = HOTEL_GRADE;
const WRONG = HOTEL_WRONG;

/** 사건 이후 첫 문장. 범인과 큰 흐름을 맞힌 solved는 반려가 아니다 (2026-10-16 플레이 리뷰) */
const AFTER_LEAD: Record<string, string> = {
  perfect: '보고서가 받아들여졌다. 몇 달 뒤, 사건에 이름을 올린 사람들은 각자 이렇게 남았다.',
  solved: '보고서의 결론은 받아들여졌다. 빠진 몇 가지는 보충 수사로 채워졌다.\n몇 달 뒤, 사건에 이름을 올린 사람들은 각자 이렇게 남았다.',
  insufficient: '보고서는 근거가 부족해 반려되었다. 사건은 재수사를 거쳐 다음과 같이 정리되었다.',
  wrong: '보고서는 반려되었다. 사건은 재수사를 거쳐 다음과 같이 정리되었다.',
};

export function Result() {
  const { state, dispatch } = useGame();
  const r = state.result;
  if (!r) return null;
  const g = GRADE[r.grade];
  return (
    <div className="center-screen">
      <Box mode="double" className="card-scrolls result card" seed="result">
        <div className="card-scroll">
          <div className="code">수사 결과</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <div className="grade">{g.title}</div>
            <Seal text={g.seal} size={64} style={{ fontSize: 15, transform: 'rotate(-8deg)' }} />
          </div>
          <p style={{ whiteSpace: 'pre-line' }}>{r.grade === 'wrong' ? `${WRONG[state.report.culprit!]}\n진범은 따로 있었다.` : g.text}</p>
          {r.grade === 'solved' && (
            <p className="muted">범인과 사건의 큰 흐름은 수사 결론으로 인정됐다.<br />아래 보고서에서 빠지거나 흐릿했던 부분은 보충 수사로 넘어갔다.</p>
          )}
          {r.grade === 'perfect' && !state.owned.includes(CONFESSION) && (
            <p className="muted">{PERSONS.C.name}의 자백은 받지 못했다.<br />보고서의 결론은 확보한 자료와 진술이 뒷받침하는 범위까지이고, 정확한 타격 순간과 정리 경위는 재수사로 넘어갔다.</p>
          )}
          <div className="result-sheet">
            <ReportSheet draft={state.report} graded={r} />
          </div>
          <div className="cover-actions">
            <Box as="button" mode="double" className="btn" seed="epi" onClick={() => dispatch({ type: 'screen', screen: 'epilogue' })}>진상 해설 보기</Box>
            <Box as="button" className="btn" seed="after" onClick={() => dispatch({ type: 'screen', screen: 'afterword' })}>사건 이후</Box>
            <Box as="button" className="btn" seed="back" onClick={() => dispatch({ type: 'screen', screen: 'hub' })}>수사 본부로</Box>
            <Box as="button" className="btn" seed="cover2" onClick={() => dispatch({ type: 'screen', screen: 'title' })}>표지로</Box>
          </div>
        </div>
      </Box>
    </div>
  );
}


/**
 * 사건 이후: 인물별 짧은 후일담. 살인의 책임과 다른 잘못의 책임을 나눠 적는다.
 * 플레이어가 들은 진술에 따른 문장만 덧붙이고, 묻지 않은 개인사는 들은 것처럼 쓰지 않는다.
 */
export function Afterword() {
  const { state, dispatch } = useGame();
  const owned = new Set(state.owned);
  const grade = state.result?.grade ?? 'wrong';
  return (
    <div className="center-screen">
      <Box mode="double" className="card-scrolls afterword card" seed="afterword">
        <div className="card-scroll">
          <div className="code">사건 이후</div>
          <h2 className="afterword-title">그 뒤의 기록</h2>
          <p className="afterword-lead" style={{ whiteSpace: 'pre-line' }}>
            {AFTER_LEAD[grade] ?? AFTER_LEAD.wrong}
          </p>
          {AFTERWORD.map((a) => (
            <div key={a.person} className="afterword-item">
              <Portrait person={a.person} w={52} h={64} />
              <div>
                <div className="afterword-name">{PERSONS[a.person].name} <span className="muted">{PERSONS[a.person].role}</span></div>
                <p style={{ whiteSpace: 'pre-line' }}>{a.text}</p>
                {(a.extra ?? []).filter((x) => owned.has(x.has)).map((x) => <p key={x.has} className="afterword-extra" style={{ whiteSpace: 'pre-line' }}>{x.text}</p>)}
              </div>
            </div>
          ))}
          <div className="cover-actions">
            <Box as="button" className="btn" seed="aw-epi" onClick={() => dispatch({ type: 'screen', screen: 'epilogue' })}>진상 해설</Box>
            <Box as="button" className="btn" seed="aw-res" onClick={() => dispatch({ type: 'screen', screen: 'result' })}>결과로</Box>
            <Box as="button" className="btn" seed="aw-title" onClick={() => dispatch({ type: 'screen', screen: 'title' })}>표지로</Box>
          </div>
        </div>
      </Box>
    </div>
  );
}
