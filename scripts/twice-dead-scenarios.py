"""「두 번 죽은 남자」 수사 시나리오 계산기.

조사 행동마다 선행 조건, 얻는 자료, 실제 플레이 시간(분), 게임 속 시간을 적어 두고
시나리오(행동 순서)를 돌려 다음을 계산한다.
- 선행 조건이 순서대로 채워지는지 (설계 검증)
- 실제 플레이 시간 (행동 시간 합 × 생각 시간 배수)
- 게임 속 날짜 (근무 09~21시, 결과 대기, 비 12-13 14:00, 기한 2007-01-10 18:00)
- 풀린 의문 수첩, 덤 사건, 결말

실행: python scripts/twice-dead-scenarios.py  (마크다운 표를 출력)
기준 문서: design/twice-dead-case.md, design/twice-dead-flow.md
"""
from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta

START = datetime(2006, 12, 11, 9)
RAIN = datetime(2006, 12, 13, 14)
DEADLINE = datetime(2007, 1, 10, 18)
DAY_START, DAY_END = 9, 21
SITTING = 60   # 한 번 앉아서 하는 시간(분) 가정
RESUME = 1.5   # 이어 하기 한 번에 드는 분


@dataclass
class Act:
    id: str
    label: str
    real: float            # 실제 플레이 분 (읽기·입력·대화)
    game: float = 0        # 게임 속 근무 시간
    wait: float = 0        # 결과가 오기까지 달력 시간 (근무 시간과 무관하게 흐름)
    needs: tuple = ()      # 이 자료가 모두 있어야 함
    any_of: tuple = ()     # (n, (자료...)) — 이 중 n개 이상
    gives: tuple = ()
    before_rain: tuple = ()  # 비 오기 전에 했을 때만 주는 자료


A = {a.id: a for a in [
    Act('A00', '시작 컷신', 2.5),
    Act('A01', '첫 회의 자료 읽기·반장 브리핑', 5, gives=('E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07')),
    # 현장
    Act('F01', '별채 다시 보기', 2, 1, gives=('E11',)),
    Act('F02', '장판 물 자국', 1, .5, needs=('E11',), gives=('E12',)),
    Act('F03', '난로·등유', 1, .5, needs=('E11',), gives=('E13',)),
    Act('F04', '방파제 수색', 3, 3, gives=('E20', 'E21', 'E22'), before_rain=('E20s',)),
    Act('F05', '본채(지아 방) 수색', 3, 2, needs=('W01',), gives=('E26', 'E27', 'E36')),
    Act('F07', '백씨 집 차고', 1.5, 1, gives=('E23',)),
    # 감정
    Act('L10', '부검 전문', 2, gives=('E03a', 'E14')),
    Act('L11', '부검의에게 묻기(옮겨졌나)', 1.5, needs=('E03a',), gives=('E15',)),
    Act('L13', '계단 혈흔 DNA', 1, wait=120, needs=('E20s',), gives=('E29',)),
    Act('L14', '손톱 밑 섬유 대조', 1, wait=72, needs=('E14', 'E27'), gives=('E28',)),
    Act('L16', '카드 필적', 1, wait=72, needs=('CARDS',), gives=('E17',)),
    # 기록
    Act('R20', '112 녹음 원본', 3, 4, gives=('E10',)),
    Act('R21', '해경 2003 실종 기록', 2, wait=24, gives=('E41',)),
    Act('R22', '보험 서류', 2, wait=24, gives=('E42',)),
    Act('R23', '띠지 은행 조회', 1, wait=24, needs=('E04',), gives=('E32',)),
    Act('R24', '백승철 계좌(영장)', 2, 1, wait=48, needs=('E32',), gives=('E30',)),
    Act('R25', '이도현 계좌(영장)', 2, 1, wait=48, needs=('E32',), gives=('E31',)),
    Act('R26', '이도현 통화 기록', 1.5, wait=24, gives=('E34',)),
    Act('R27', '지아·경자 통화 기록', 1.5, wait=24, gives=('E35',)),
    Act('R28', '주유소 CCTV', 2, 4, gives=('E33',)),
    Act('R29', '강릉 모텔·결제', 1, wait=24, needs=('E33',), gives=('E37',)),
    Act('R30', '군청 송년회 확인', 1, 4, gives=('E38',)),
    Act('R31', '백준혁 PC방', 1, wait=24, gives=('E39',)),
    Act('R32', '2005 뺑소니 기록', 2, 4, gives=('E40',)),
    Act('R33', '공업사 수리 장부', 2, wait=48, any_of=(1, ('E04', 'E40')), gives=('E43',)),
    Act('R34', '서초서 카드 신고', 1, wait=24, gives=('E44',)),
    Act('R35', '우체국 접수', 1, 4, needs=('CARDS',), gives=('E09',)),
    Act('R37', '슈퍼 외상 장부', 1, .5, gives=('E46',)),
    Act('R38', '실종선고 기록', 1, wait=24, gives=('E45',)),
    # 탐문
    Act('C40x', '최말순 — 수상한 사람 물음(헛걸음)', 2, 1),
    Act('C40', '최말순 — 소리·다툼 물음', 2, 1, gives=('E24',)),
    Act('C41', '장복희·계원', 2, 1, gives=('E25',)),
    Act('C42', '마을 탐문(김상호)', 3, 2, gives=('E48',)),
    Act('C43', '주유소 직원', 1.5, 1, gives=('E50',)),
    Act('C44', '지아 담임', 2, 1, gives=('E49',)),
    Act('C45', '공업사 명의 직원', 2, 1, needs=('E43',), gives=('E47',)),
    # 소환 (깊은 대화)
    Act('I_BS1', '백승철 1차', 8, 4),
    Act('I_BS2', '백승철 2차(계좌·장부 제시)', 7, 4, needs=('E30', 'E43'), gives=('BS_OK',)),
    Act('I_BJ', '백준혁', 5, 4, needs=('E43',), gives=('BJ_OK',)),
    Act('I_DH1', '이도현 1차', 8, 4),
    Act('I_DH2', '이도현 2차(CCTV·계좌 제시)', 8, 4, any_of=(2, ('E33', 'E31', 'E34', 'E50')), gives=('DH_OK',)),
    Act('I_DH_ONE', '이도현 한 번에(근거 2개 이상 들고 첫 소환)', 10, 4, any_of=(2, ('E33', 'E31', 'E34', 'E50')), gives=('DH_OK',)),
    Act('I_YH', '한윤희', 7, 4, gives=('CARDS', 'YH_OK')),
    Act('I_OM', '오만석', 7, 4, any_of=(1, ('E41', 'E48')), gives=('OM_OK',)),
    Act('I_GJ1', '문경자 1차', 8, 4),
    Act('I_JA1', '문지아 1차(참고인)', 8, 4, gives=('E16',)),
    Act('W01', '본채 압수수색 영장', 3, 12, any_of=(2, ('E24', 'E35', 'E25', 'E20', 'E16', 'E49')), gives=('W01',)),
    Act('I_JA2', '문지아 피의자 전환·추궁', 8, 4, any_of=(2, ('E24', 'E35', 'E26', 'E16', 'E28', 'E36')), gives=('JA_SUS',)),
    Act('I_GJ2', '문경자 거짓 자백', 6, 4, needs=('JA_SUS',), gives=('GJ_FALSE',)),
    Act('I_GJ3', '경자 자백의 빈틈 제시', 6, 2, needs=('GJ_FALSE',), any_of=(2, ('E25', 'E35', 'E24', 'E20', 'E21')), gives=('GJ_BROKEN',)),
    Act('I_JA3', '문지아 자백', 8, 4, needs=('GJ_BROKEN',), gives=('JA_CONF',)),
    Act('I_JA4', '지아에게 112 신고를 알려 줌', 2, gives=('TOLD',)),
    # 조정안 (design/twice-dead-flow.md 6절)
    Act('I_CLIMAX', '조사실 한 장면: 지아 추궁 → 경자 거짓 자백 → 빈틈 → 지아 자백', 15, 4,
        any_of=(3, ('E24', 'E35', 'E25', 'E20', 'E21', 'E16', 'E26', 'E28', 'E36')),
        gives=('JA_SUS', 'GJ_FALSE', 'GJ_BROKEN', 'JA_CONF')),
    Act('R19', '위장 사망 서류 묶음(해경·보험·실종선고)', 4, wait=24, gives=('E41', 'E42', 'E45')),
    Act('I_CLIMAX_STOP', '조사실 장면: 지아 추궁 → 경자 거짓 자백을 받아들임', 10, 4,
        any_of=(2, ('E24', 'E35', 'E25', 'E20', 'E21', 'E16', 'E26', 'E28', 'E36')),
        gives=('JA_SUS', 'GJ_FALSE')),
    Act('X01', '송치 의견서', 6),
    Act('X02', '결말 컷신', 3),
]}

QUESTIONS = {
    'Q1 3년 전 죽은 사람': (('E41', 'OM_OK'),),
    'Q2 보험금과 재혼': (('YH_OK', 'DH_OK'),),
    'Q3 마른 방바닥의 익사': (('E03a', 'E12', 'E20'),),
    'Q4 천장 돈과 사진': (('E30', 'E31'), ('BS_OK', 'DH_OK')),
    'Q5 112 두 시간 뒤의 죽음': (('E10', 'JA_CONF'),),
    'Q6 죽은 다음 날 카드': (('E09',),),
    'Q7 작년에도 온 카드': (('E44', 'CARDS'),),
}
# 지아 전체 자백으로 "진술로 확인"이 되는 의문 (설정집 11절)
BY_STATEMENT = {'Q1 3년 전 죽은 사람', 'Q3 마른 방바닥의 익사', 'Q4 천장 돈과 사진'}
SIDE = {
    '위장 사망 공모': ('E41', 'OM_OK'),
    '이도현 은폐': ('DH_OK',),
    '뺑소니·은폐': ('E43', 'BS_OK'),
}


@dataclass
class Result:
    name: str
    real: float
    days: int
    finish: datetime
    rain_ok: bool
    questions: list = field(default_factory=list)
    stated: list = field(default_factory=list)
    side: list = field(default_factory=list)
    errors: list = field(default_factory=list)


def run(name: str, steps: list[str], think: float, accuse: str | None) -> Result:
    have: set[str] = set()
    pending: dict[str, datetime] = {}
    clock = START
    real = 0.0
    errors = []
    days_ended = 0

    def advance(hours: float):
        nonlocal clock, days_ended
        clock += timedelta(hours=hours)
        while clock.hour >= DAY_END or clock.hour < DAY_START:
            nxt = (clock + timedelta(days=1 if clock.hour >= DAY_END else 0)).replace(hour=DAY_START, minute=0)
            clock = nxt
            days_ended += 1

    def collect():
        for k, t in list(pending.items()):
            if t <= clock:
                have.add(k)
                del pending[k]

    def need(keys):
        nonlocal clock, days_ended
        collect()
        missing = [k for k in keys if k not in have]
        waits = [pending[k] for k in missing if k in pending]
        if waits and len(waits) == len(missing):
            target = max(waits)
            while clock < target:  # 하루 마치기
                clock = (clock + timedelta(days=1)).replace(hour=DAY_START, minute=0)
                days_ended += 1
            collect()
        return [k for k in keys if k not in have]

    for sid in steps:
        a = A[sid]
        miss = need(a.needs)
        if miss:
            errors.append(f'{sid}: 없음 {miss}')
        if a.any_of:
            n, pool = a.any_of
            got = [k for k in pool if k in have]
            if len(got) < n:
                need([k for k in pool if k in pending][: n - len(got)])
                got = [k for k in pool if k in have]
                if len(got) < n:
                    errors.append(f'{sid}: {n}개 필요, 있는 것 {got}')
        real += a.real
        advance(a.game)
        gives = list(a.gives) + (list(a.before_rain) if clock < RAIN else [])
        for g in gives:
            if a.wait:
                pending[g] = clock + timedelta(hours=a.wait)
            else:
                have.add(g)
        collect()
    real += days_ended * 0.5  # 하루 마치기 + 아침 보고 읽기 (설정집 2.5)
    rain_ok = 'E20s' in have or 'E20s' in pending
    qs = [q for q, alts in QUESTIONS.items() if any(all(k in have for k in alt) for alt in alts)]
    stated = [q for q in BY_STATEMENT if q not in qs and 'JA_CONF' in have]
    side = [s for s, req in SIDE.items() if all(k in have for k in req)]
    total = real * think
    sessions = max(1, -(-int(total) // SITTING))
    total += (sessions - 1) * RESUME  # 이어 할 때 아침 보고를 다시 읽고 감을 되찾는 시간
    r = Result(name, total, days_ended, clock, rain_ok, questions=qs, side=side, errors=errors)
    r.sessions = sessions
    r.stated = sorted(stated)
    r.accuse = accuse
    r.have = have
    return r


# 시나리오 — design/twice-dead-flow.md 4절과 같은 순서 (설정집 1.2 기준: 결정적 장면 한 장면, 서류 묶음, 백준혁 선택)
SCENARIOS = {
    'S1 바다에서 출발 (최단)': (1.15, '지아', [
        'A00', 'A01', 'L10', 'L11', 'F04', 'C40', 'R27', 'C41', 'F01', 'F02',
        'I_CLIMAX', 'X01', 'X02']),
    'S2 112 녹음에서 출발': (1.25, '지아', [
        'A00', 'A01', 'I_BS1', 'R30', 'R20', 'R32', 'F01', 'F02', 'F03', 'L10',
        'F04', 'C40x', 'C40', 'C41', 'R27', 'I_GJ1', 'W01', 'F05',
        'I_CLIMAX', 'I_JA4', 'X01', 'X02']),
    'S3 당시 수사를 따라감 (권장 흐름, 전부 풀기)': (1.3, '지아', [
        'A00', 'A01', 'I_BS1', 'R23', 'F07', 'R30', 'R31', 'I_YH', 'R28',
        'C43', 'R34', 'R35', 'R19', 'C42', 'R24', 'R25', 'R26', 'R33',
        'I_OM', 'I_DH_ONE', 'R29', 'C45', 'I_BS2', 'L16',
        'R20', 'R32', 'F01', 'F02', 'F03', 'L10', 'L11', 'F04', 'C40x', 'C40', 'C41',
        'R27', 'I_GJ1', 'I_JA1', 'C44', 'W01', 'F05', 'L14', 'I_CLIMAX', 'I_JA4',
        'X01', 'X02']),
    'S4 보험 쪽부터 (이도현 집착)': (1.3, '지아', [
        'A00', 'A01', 'I_YH', 'R19', 'R34', 'R35', 'R28', 'C43', 'R26',
        'I_DH_ONE', 'R23', 'R25', 'I_OM', 'R29', 'R20', 'R32', 'L10', 'F04',
        'C40', 'C41', 'R27', 'F01', 'F02', 'I_CLIMAX', 'X01', 'X02']),
    'S5 할머니 자백을 믿음 (오답)': (1.25, '경자', [
        'A00', 'A01', 'I_BS1', 'R30', 'R20', 'R32', 'L10', 'F04', 'C40x', 'F01',
        'F02', 'I_GJ1', 'R27', 'C41', 'I_CLIMAX_STOP', 'X01', 'X02']),
    'S6 백씨 입막음설 고집 (오답)': (1.3, '백승철', [
        'A00', 'A01', 'I_BS1', 'R23', 'F07', 'R24', 'R33', 'C45', 'I_BS2',
        'R30', 'R31', 'C42', 'R28', 'C43', 'I_DH_ONE', 'X01', 'X02']),
    'S7 지아를 직감 (근거 부족)': (1.35, '지아', [
        'A00', 'A01', 'C42', 'C44', 'I_JA1', 'I_GJ1', 'L10', 'L11', 'F01', 'F02',
        'F03', 'F04', 'C40x', 'C40', 'R27', 'C41', 'I_CLIMAX', 'X01', 'X02']),
}

# 이전 판의 결과. twice-dead-flow.md 비교표용 기록값
BEFORE = {'S1': 78, 'S2': 125, 'S3': 230, 'S4': 154, 'S5': 92, 'S6': 93, 'S7': 114}   # 설정집 1.1
PREV = {'S1': 63, 'S2': 109, 'S3': 205, 'S4': 136, 'S5': 86, 'S6': 86, 'S7': 96}      # 설정집 1.2
SHARE = {'S1': .05, 'S2': .25, 'S3': .35, 'S4': .15, 'S5': .10, 'S6': .05, 'S7': .05}


def ending(r: Result) -> str:
    if r.accuse == '지아':
        return '해결' if 'JA_CONF' in r.have else '알았지만 증명 못 함'
    if r.accuse == '경자':
        return '할머니의 거짓 자백'
    return '엉뚱한 사람'


def main():
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    rows = []
    for name, (think, accuse, steps) in SCENARIOS.items():
        r = run(name, steps, think, accuse)
        rows.append((r, len(steps)))
    print('| 시나리오 | 행동 수 | 실제 플레이(분) | 1.2 | 1.1 | 앉는 횟수(60분) | 게임 속 날짜 | 송치 시점 | 방파제 혈흔 DNA | 의문 (증거/진술) | 덤 사건 | 결말 | 검증 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for r, n in rows:
        q = f'{len(r.questions)}/7 + 진술 {len(r.stated)}'
        side = ', '.join(r.side) or '—'
        err = '오류: ' + '; '.join(r.errors) if r.errors else '통과'
        key = r.name.split(' ')[0]
        print(f'| {r.name} | {n} | {r.real:.0f} | {PREV[key]} | {BEFORE[key]} | {r.sessions} | {r.days + 1}일 | {r.finish:%m-%d %H시} | '
              f'{"가능" if r.rain_ok else "비 뒤라 불가"} | {q} | {side} | {ending(r)} | {err} |')
    print()
    for r, _ in rows:
        st = ", ".join(x.split(" ")[0] for x in r.stated)
        print(f'- {r.name}: 증거로 = {", ".join(x.split(" ")[0] for x in r.questions) or "없음"}'
              + (f' / 진술로 = {st}' if st else ''))
    avg = sum(SHARE[r.name.split(' ')[0]] * r.real for r, _ in rows)
    before = sum(SHARE[k] * v for k, v in BEFORE.items())
    print()
    prev = sum(SHARE[k] * v for k, v in PREV.items())
    print(f'가중 평균(SHARE 기준): {avg:.0f}분 (1.2 {prev:.0f}분, 1.1 {before:.0f}분)')


if __name__ == '__main__':
    main()
