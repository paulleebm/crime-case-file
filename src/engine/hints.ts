import { CHALLENGES, PERSONS } from '../data/case';
import { HINTS, HINT_HONEST, HINT_ORDER, HINT_REPORT, HINT_SETTLED, HINT_TAKE, MAIN_PATH } from '../data/hints';
import { STATEMENT_FORMS } from '../data/statementForms';
import { beatById, SPOILERS } from '../data/storyPath';
import { evidenceById } from './lookup';
import type { Challenge, PersonId } from '../data/types';
import { sourceId, visibleClaims } from './claims';
import { josa } from './josa';

/** 막힘으로 치는 응답 */
export const STUCK_KINDS = new Set(['nearMiss', 'irrelevant', 'unknown', 'clarify', 'repeat']);

/** 연달아 막힌 횟수가 이 값이면 수첩이 열린다: 3번째에 1단계, 5번째에 2단계, 이후 3번마다 2단계 */
export function hintLevel(streak: number): 0 | 1 | 2 {
  if (streak === 3) return 1;
  if (streak >= 5 && (streak - 5) % 3 === 0) return 2;
  return 0;
}

const order = (c: Challenge) => {
  const i = HINT_ORDER.indexOf(c.id);
  return i < 0 ? 99 : i;
};

/** 깨야 할 거짓말을 플레이어가 이미 들었는가 */
const heard = (c: Challenge, owned: Set<string>) => {
  const visible = new Set(visibleClaims(c.person, owned).map((x) => x.id));
  return c.lies.some((l) => visible.has(l));
};

/** 거짓말을 들었고, 그것을 깰 근거 조합도 지금 다 가지고 있는가 */
const ready = (c: Challenge, owned: Set<string>) => heard(c, owned) && c.requires.some((set) => set.every((id) => owned.has(sourceId(id))));

/** 이 사람에게 아직 남은 지적 (대상 진술이 이미 나와 있는 것만) */
function pending(person: PersonId, owned: Set<string>, done: Set<string>): Challenge[] {
  return CHALLENGES
    .filter((c) => c.person === person && !done.has(c.id) && c.targets.some((t) => owned.has(t)))
    .sort((a, b) => Number(ready(b, owned)) - Number(ready(a, owned)) || order(a) - order(b));
}

function textFor(c: Challenge, owned: Set<string>, level: 1 | 2): string {
  const h = HINTS[c.id];
  if (!heard(c, owned) && h.ask) return h.ask;
  const pair = !ready(c, owned) && h.blocked ? h.blocked : h.ready;
  return pair[level - 1];
}

/**
 * 수사 수첩 한 줄. person에게서 막혔을 때, 그 사람에게 남은 실마리를 짚어 준다.
 * 그 사람이 다 털어놓았다면 진상으로 가는 다음 사람을 권한다.
 */
export function hintFor(person: PersonId, owned: Set<string>, done: Set<string>, level: 1 | 2): string {
  if (!owned.has(STATEMENT_FORMS[person].statementId)) return HINT_TAKE(PERSONS[person].name);
  const mine = pending(person, owned, done)[0];
  if (mine) return textFor(mine, owned, level);
  const next = MAIN_PATH
    .map((id) => CHALLENGES.find((c) => c.id === id)!)
    .filter((c) => !done.has(c.id) && c.person !== person && c.targets.some((t) => owned.has(t)))
    .sort((a, b) => Number(ready(b, owned)) - Number(ready(a, owned)))[0];
  // 처음부터 숨기는 것이 없는 사람에게는 "다 털어놓았다"가 아니라 "어긋나는 데가 없다"고 쓴다
  const lead = CHALLENGES.some((c) => c.person === person) ? HINT_SETTLED : HINT_HONEST;
  if (!next) {
    const untaken = (Object.keys(PERSONS) as PersonId[]).find((p) => !owned.has(STATEMENT_FORMS[p].statementId));
    return `${lead} ${untaken ? HINT_TAKE(PERSONS[untaken].name) : HINT_REPORT}`;
  }
  return `${lead} 다음은 ${PERSONS[next.person].name} 쪽을 살펴보자. ${textFor(next, owned, level)}`;
}

/** 이 사람에게 남은 지적이 하나도 없는가 (다 털어놓음) */
export function settled(person: PersonId, done: Set<string>): boolean {
  return CHALLENGES.filter((c) => c.person === person).every((c) => done.has(c.id));
}

// ─────────────── 게임 전체 힌트 (우상단 힌트 버튼) ───────────────
// data/storyPath.ts의 이상적인 선형 경로를 따라 "지금 단계"를 고르고, 그 단계에서 할 행동 하나를 권한다.
//   1단계(levels[0]): 방향 — 무엇을 확인할지. 그 단계의 깨달음(realize)은 말하지 않는다.
//   2단계(levels[1]): 행동 — 누구에게 무엇을 묻거나, 수사팀에 무엇을 요청하거나, 어떤 말에 어떤 자료를 붙일지.
// 범인을 직접 말하지 않는다. 아직 받지 않은 자료의 내용, 다음 단계의 반전은 말하지 않는다(SPOILERS).
// 이미 끝낸 단계는 건너뛴다. 핵심 자료를 받았지만 아직 읽지 않았으면 먼저 읽으라고 한다.

export interface HintStep {
  key: string;
  title: string;
  levels: string[];
  /** 경로의 단계 (data/storyPath.ts) */
  beat?: string;
  /** 이 단계에서 플레이어가 스스로 깨달아야 할 것 (힌트에 쓰지 않는다) */
  realize?: string;
  /** 지금 힌트에 쓰면 안 되는 낱말 */
  forbid?: string[];
  /** 그다음 목표 (플레이어가 지금 단계를 이미 짐작했을 때 AI가 쓴다) */
  next?: HintStep;
}

/** 지금 힌트에 쓰면 안 되는 낱말 (아직 풀리지 않은 반전·자료의 내용) */
export function forbiddenWords(owned: Set<string>): string[] {
  return SPOILERS.filter((x) => !x.unlock.some((id) => owned.has(id))).flatMap((x) => x.words);
}

const VISIT = ['B-Q04', 'B-Q05', 'B-Q06', 'B-Q07', 'B-Q08', 'B-Q09', 'B-Q10', 'B-Q11'];

/**
 * 다음에 할 일 하나. 이미 가진 자료·들은 말·진행 중인 조사·읽지 않은 자료를 보고 고른다.
 *  - 이미 한 일은 권하지 않는다. 결과를 기다리는 중이면 기다리는 동안 할 일을 권한다.
 *  - 사건 해결에 쓰이지 않는 일(통화 내역, 참고 자료)은 권하지 않는다.
 *  - 2026-10-17 사용자: 앞 단계 자료 한두 개를 안 봤어도 수사가 이미 뒷단계로 넘어갔으면 그 앞 자료를 받으라고 돌려보내지 않는다.
 *    플레이어가 닿은 가장 뒤 단계(reach)를 먼저 보고, 그보다 앞의 자료 모으기 단계는 건너뛴다.
 *  - next: 그다음 목표. 플레이어가 대화에서 지금 단계를 이미 짐작했으면 AI가 그쪽으로 힌트를 쓴다 (ai/hint.ts).
 */
export function nextHint(owned: Set<string>, done: Set<string>, jobs: { inv: string }[] = [], unseen: string[] = []): HintStep {
  const steps = hintSteps(owned, done, jobs, unseen);
  const first = steps[0];
  const next = steps.find((s) => s.beat !== first.beat);
  return next && first.beat !== 'report' ? { ...first, next } : first;
}

/** 단계별 진척 표시: 이 가운데 하나라도 있으면 그 단계까지 왔다 */
const REACH: [string, (has: (id: string) => boolean, done: Set<string>) => boolean][] = [
  ['phone', (h) => h('GT-E05')],
  ['scene', (h) => ['GT-E19', 'GT-E23', 'A-Q03', 'A-Q09'].some(h)],
  ['trophy', (h) => ['GT-E09', 'GT-E10', 'GT-E28'].some(h)],
  ['weapon', (h) => h('GT-E11')],
  ['time', (h, d) => h('GT-E14') || d.has('X-L03')],
  ['l03', (_, d) => d.has('X-L03')],
  ['room', (h) => h('GT-E07')],
  ['l01', (_, d) => d.has('X-L01')],
  ['l02', (_, d) => d.has('X-L02')],
  ['l04', (h) => h('GT-E15')],
];
const reachIndex = (beat: string) => REACH.findIndex(([b]) => b === beat);

/** 지금 상태에서 남은 단계를 순서대로 (첫째가 지금 할 일) */
function hintSteps(owned: Set<string>, done: Set<string>, jobs: { inv: string }[], unseen: string[]): HintStep[] {
  const has = (id: string) => owned.has(id);
  const any = (...ids: string[]) => ids.some(has);
  const waiting = (...invs: string[]) => jobs.some((j) => invs.includes(j.inv));
  const forbid = forbiddenWords(owned);
  const wait = '수사팀 결과를 기다리는 동안, 세 사람에게 그날 저녁 일을 더 물어보자.';
  const T = '문태준';
  const told = (cid: string) => heard(CHALLENGES.find((c) => c.id === cid)!, owned);
  const far = REACH.reduce((m, [, ok], i) => (ok(has, done) ? i : m), -1);
  /** 이 단계보다 뒤까지 이미 왔는가 (그러면 이 단계의 자료 모으기는 건너뛴다) */
  const passed = (beat: string) => far > reachIndex(beat);
  const out: HintStep[] = [];
  /** 단계 하나. 그 단계의 핵심 자료를 받았는데 아직 읽지 않았으면 먼저 읽으라고 한다 */
  const step = (beat: string, key: string, levels: string[], read: string[] = []) => {
    const b = beatById.get(beat)!;
    const unread = read.filter((id) => owned.has(id) && unseen.includes(id)).map((id) => `「${evidenceById.get(id)?.title ?? id}」`);
    const lv = unread.length ? [`자료함에 아직 읽지 않은 ${josa(unread.join(', '), '이/가')} 있다.\n먼저 읽어 보자.`, ...levels] : levels;
    out.push({ key, title: b.title, levels: lv, beat, realize: b.realize, forbid });
  };
  const final = has('GT-E15');

  // 1. 마지막 문자: 발견한 사람이 왜 올라갔나
  if (!has('GT-E05') && !passed('phone')) step('phone', 'h-phone', [
    '발견한 사람이 왜 그 시간에 집무실로 올라갔는지부터 듣자.',
    '준서에게 그날 밤 아버지와 주고받은 연락을 묻고, 받은 문자를 보여 달라고 하자.']);
  // 2. 현장: 무엇이 없어졌나
  if (!REACH[1][1](has, done) && !passed('scene')) step('scene', 'h-scene', [
    '현장에서 흉기가 나오지 않았다.\n집무실에 원래 있던 것 가운데 없어진 것이 있는지 확인하자.',
    waiting('GT-R16') ? wait : '수사팀에 집무실 현장 감식을 요청하자.'], ['GT-E05']);
  // 3. 사라진 물건의 행방
  if (!has('GT-E09') && !passed('trophy')) step('trophy', 'h-trophy', [
    '진열대에서 사라진 물건은 지금 어디에 있을까?',
    !any('A-Q03', 'A-Q09') ? '준서에게 그 물건을 어떻게 했는지 물어보자.' : waiting('GT-R06', 'GT-R07') ? wait : '수사팀에 트로피 매각·보관 기록을 요청하자.'], ['GT-E19']);
  // 4. 흉기 확정과 사인
  if ((!has('GT-E11') || !has('GT-E04')) && !passed('weapon')) {
    const ask = [!has('GT-E04') && '사인 감정', !has('GT-E11') && '매입점에 있는 트로피를 회수해 상처와 대조하는 감정'].filter(Boolean).join('과 ');
    step('weapon', 'h-weapon', [
      '회장의 머리를 친 물건은 무엇이었을까?\n사라졌던 물건과 상처를 맞춰 보자.',
      waiting('GT-R01', 'GT-R07') ? wait : `수사팀에 ${ask}을 요청하자.`], ['GT-E09']);
  }
  // 5. 시간의 모순: 흉기가 나간 시각과 9시 10분 문자. 예약이라는 말은 하지 않는다 (플레이어가 모순을 찾는다)
  if (!has('GT-E14') && !done.has('X-L03') && !passed('time')) step('time', 'h-time', [
    '흉기가 매입점에 들어간 시각과, 회장이 문자를 보낸 시각을 나란히 놓아 보자.\n사인 감정의 소견도 함께 떠올려 보자.',
    waiting('GT-R10', 'GT-R11') ? wait : '그 두 시각이 함께 성립할 수 있을까?\n9시 10분 문자가 정말 그때 회장의 손으로 보내졌는지, 수사팀에 그 문자가 어떻게 보내졌는지 확인해 달라고 하자.'],
    ['GT-E04', 'GT-E09', 'GT-E11']);
  // 6. 태준의 21:10 생존 주장 (예약 등록 기록까지 받았으면 마지막 단계에서 함께 무너진다)
  if (!done.has('X-L03') && !final) {
    if (!told('X-L03')) step('l03', 'h-l03-ask', [
      '회장이 마지막으로 살아 있던 때를, 그 방에 있던 사람은 어떻게 말할까?',
      `${T}에게 회장이 언제까지 살아 있었다고 보는지 물어보자.`], ['GT-E14']);
    else if (has('GT-E14')) step('l03', 'h-l03', [
      `${T}은 9시 10분 문자를 회장이 그때까지 살아 있었다는 근거로 든다.\n확보한 문자 발송 기록과 맞춰 보자.`,
      `${T}의 그 말에 「21:10 문자 발송 방식」의 문장을 근거로 붙여 내밀자.`], ['GT-E14']);
    else step('l03', 'h-l03-get', [
      `${T}은 9시 10분 문자를 회장이 그때까지 살아 있었다는 근거로 든다.\n그 문자가 어떻게 보내졌는지 확인할 기록이 있을까?`,
      waiting('GT-R10') ? wait : '수사팀에 9시 10분 문자가 어떻게 보내졌는지 확인해 달라고 하자.']);
  }
  // 7. 흉기가 나가기 전 그 방에 있던 사람 (문 기록에는 이름이 없다)
  if ((!has('GT-E07') || !any(...VISIT)) && !passed('room') && !done.has('X-L02') && !final) {
    const parts = [
      !has('GT-E07') && (waiting('GT-R04') ? '' : '수사팀에 집무실 출입 기록을 요청하자.'),
      !any(...VISIT) && '민아에게 트로피를 가지러 갔을 때 집무실에서 누구를 봤는지, 몇 시쯤이었는지 물어보자.',
    ].filter(Boolean).join('\n');
    step('room', 'h-room', [
      '흉기가 집무실을 나가기 전, 그 방에 누가 드나들었는지 확인하자.',
      parts || wait], ['GT-E07']);
  }
  // 8. 방문 목적 (예약 등록 기록까지 왔으면 자백 뒤에 저절로 풀린다)
  if (!done.has('X-L01') && !final) {
    if (!told('X-L01')) step('l01', 'h-l01-ask', [`${T}이 그날 집무실에 간 이유를 확인하자.`, `${T}에게 집무실에 무슨 일로 갔는지, 회장과 다툰 일은 없었는지 물어보자.`]);
    else if (!any('GT-E13', 'GT-E30', 'GT-E31', 'GT-E34')) step('l01', 'h-l01-get', ['정기 보고였다는 말을 확인할 원본이 있을까?', waiting('GT-R09') ? wait : '수사팀에 회장과 태준 사이의 업무 연락과 정산 자료를 요청하자.']);
    else step('l01', 'h-l01', ['정기 보고였다는 말과 그날 회장의 연락을 맞춰 보자.', '“정기 운영 보고였다”는 말에 소명 요청·정산 자료의 문장을 근거로 붙여 내밀자.'], ['GT-E13']);
  }
  // 9. 20:50에 문을 연 사람 (태준의 "8시 45분에 나왔다")
  if (!done.has('X-L02') && !final) {
    if (!told('X-L02')) step('l02', 'h-l02-ask', ['문 기록의 시각마다 누구였는지 확인하자.', `${T}에게 집무실에서 몇 시에 나왔는지, 민아를 봤는지 물어보자.`]);
    else if (!any('GT-E28', 'GT-E10')) step('l02', 'h-l02-get', ['민아가 그 무렵 실제로 어디 있었는지 다른 곳의 기록을 찾아보자.', waiting('GT-R25', 'GT-R06') ? wait : '수사팀에 매입점 방문 대장을 요청하자.']);
    else step('l02', 'h-l02', ['민아가 매입점에 들어간 시각과 집무실 문이 열린 시각을 나란히 놓아 보자.', '“8시 45분에 나왔다”는 말에 집무실 문 열림 기록과 민아의 매입점 도착 기록을 함께 붙여 내밀자.'], ['GT-E07', 'GT-E28']);
  }
  // 10. 예약한 사람
  if (!done.has('X-L04')) {
    if (!told('X-L04') && !final) step('l04', 'h-l04-ask', ['그 문자를 예약한 사람은 누구일까?', `${T}에게 회장 휴대폰으로 문자를 예약한 적이 있는지 물어보자.`]);
    else if (!final) step('l04', 'h-l04-get', ['예약이 언제, 어디서 등록됐는지 알아야 한다.', waiting('GT-R11') ? wait : '수사팀에 그 문자가 회장 휴대폰에 언제 예약 등록됐는지 확인해 달라고 하자.']);
    else if (!done.has('X-L02') && !any('GT-E10', 'GT-E28', 'GT-E09') && !(has('GT-E04') && has('GT-E11'))) step('l04', 'h-l04-more', ['예약이 등록된 시각에 누가 어디 있었는지 맞춰 보자.', waiting('GT-R06', 'GT-R25') ? wait : '수사팀에 매입점 방문 대장을 요청하자.'], ['GT-E15']);
    else {
      const room = done.has('X-L02') ? '50분까지 안에 있었다는 태준의 인정' : has('GT-E07') && any('GT-E10', 'GT-E28') ? '집무실 문 열림 기록과 민아의 매입점 도착 기록' : '흉기 대조와 사인 감정';
      step('l04', 'h-l04', ['흉기, 예약 등록 시각, 그때 세 사람이 있던 곳을 연결하자.',
        `“예약한 적 없다”는 말에 휴대폰 상세 분석과 ${room}을 함께 붙여 내밀자.\n한 번에 넷까지 붙일 수 있고, 앞서 받아 낸 인정도 근거가 된다.`], ['GT-E15']);
    }
  }
  step('report', 'report', ['진술이 모두 정리됐다.\n왼쪽 맨 아래 사건 재구성을 마무리해 제출하자.']);
  return out;
}
