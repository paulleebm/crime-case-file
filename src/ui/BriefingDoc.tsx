import { BRIEFING, CASE_NO, CASE_TITLE, POLICE } from '../data/case';
import { Box, Seal } from '../sketch/components';

/** 사건 개요: A4 공문 형식. 수사 방법 안내는 여기에 모은다 */
export function BriefingDoc() {
  return (
    <div className="a4-wrap">
      <Box mode="double" className="a4 sheet" seed="a4-brief">
        <div className="a4-org">{POLICE.split('').join(' ')}</div>
        <table className="a4-approve">
          <tbody>
            <tr><th>담당</th><th>팀장</th><th>과장</th></tr>
            <tr><td><Seal text="수사" size={30} /></td><td><Seal text="강" size={30} /></td><td><Seal text="전결" size={30} /></td></tr>
          </tbody>
        </table>
        <table className="a4-head">
          <tbody>
            <tr><th>문서 번호</th><td>형사과-{CASE_NO}</td><th>시행 일자</th><td>2026. 10. 14.</td></tr>
            <tr><th>수신</th><td>담당 수사관</td><th>참조</th><td>강력팀장</td></tr>
            <tr><th>제목</th><td colSpan={3}><b>{CASE_TITLE} 수사 인계</b></td></tr>
          </tbody>
        </table>

        <h4>1. 사건 개요</h4>
        {BRIEFING.slice(0, 3).map((p, i) => <p key={i} style={{ whiteSpace: 'pre-line' }}>{p}</p>)}

        <h4>2. 피해자와 면담 대상</h4>
        <table className="a4-table">
          <thead><tr><th>성명</th><th>소속 · 직책</th><th>그날 저녁</th><th>비고</th></tr></thead>
          <tbody>
            <tr><td>류정환 (63)</td><td>호텔 로베르 운영 회사 회장</td><td>3층 집무실</td><td>피해자</td></tr>
            <tr><td>류준서 (32)</td><td>회장의 외아들</td><td>집무실에 올라가 발견</td><td>신고자</td></tr>
            <tr><td>서민아 (27)</td><td>호텔 행사 지원 직원</td><td>회의 준비</td><td></td></tr>
            <tr><td>문태준 (42)</td><td>호텔 총지배인</td><td>21시 회의</td><td></td></tr>
          </tbody>
        </table>

        <h4>3. 수사 목표</h4>
        <p>그날 저녁 집무실에서 무슨 일이 있었는지 밝힌다.<br />범인과 그 근거를 사건 재구성으로 정리해 제출한다.</p>

        <h4>4. 수사 유의사항</h4>
        <ol className="a4-steps">
          <li><b>면담</b> 왼쪽에서 용의자를 누르면 진술서와 대화창이 열린다.<br />궁금한 것을 그대로 물으면 된다.<br />들은 내용은 진술서에 정리된다.</li>
          <li><b>자료 요청</b> 원본 기록과 감정 결과는 저절로 오지 않는다.<br />수사팀에 “부검 결과 보내 주세요”처럼 요청하면, 조사가 끝난 뒤 자료함에 들어온다.<br />기다리는 동안 면담을 계속해도 된다.<br />관계자 휴대폰 속 내용은 그 사람에게 직접 보여 달라고 한다.</li>
          <li><b>근거 제시</b> <u>밑줄 친 문장</u>을 누르면 왼쪽 아래 근거 트레이에 담긴다.<br />근거를 대화창으로 끌어다 놓고 ‘근거 제시’를 누른다.<br />진술과 어긋나는 근거를 내밀면 상대가 사실을 인정한다.<br />한 번에 넷까지 함께 낼 수 있다.</li>
          <li><b>힌트</b> 막히면 오른쪽 위 힌트를 누른다.<br />누를수록 더 자세히 알려 준다.</li>
          <li><b>사건 해결</b> 왼쪽 맨 아래 사건 재구성에서 범인과 범행을 정리해 제출한다.<br />제출은 한 번뿐이다.<br />근거가 모였을 때 낸다.</li>
        </ol>

        <div className="a4-end">끝.</div>
        <div className="a4-sign">{POLICE}장 <Seal text="서장" size={44} /></div>
      </Box>
    </div>
  );
}
