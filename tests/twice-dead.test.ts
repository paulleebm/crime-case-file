import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accuse, ask, canSummonSuspect, doAction, endDay, newGame, present, questionStates, runOrder, summon, visibleActions,
  type ColdState,
} from '../src/cold/engine';
import { ACTIONS, EVIDENCE, PERSONS } from '../src/cold/twiceDead';

// 「두 번 죽은 남자」 메뉴 뼈대. 시나리오는 design/twice-dead-flow.md 4절, scripts/twice-dead-scenarios.py와 같은 흐름.

function act(s: ColdState, id: string): ColdState {
  const [n, r] = doAction(s, id);
  assert.ok(r.ok, `${id}: ${r.say}`);
  return n;
}
/** 결과를 기다려야 하면 하루씩 넘긴다 */
function until(s: ColdState, id: string): ColdState {
  for (let i = 0; i < 10 && !s.have.includes(id); i++) s = endDay(s);
  assert.ok(s.have.includes(id), `${id}가 오지 않음`);
  return s;
}
function talk(s: ColdState, person: string, opts: Parameters<typeof summon>[2], steps: (string | { ev: string })[]): ColdState {
  let [n, r] = summon(s, person, opts);
  assert.ok(r.ok, `${person} 소환: ${r.say}`);
  for (const st of steps) {
    [n, r] = typeof st === 'string' ? ask(n, st) : present(n, st.ev);
    assert.ok(r.ok, `${person} ${JSON.stringify(st)}`);
  }
  return n;
}

test('자료·조사 항목·인물이 서로 없는 자료를 가리키지 않는다', () => {
  const ids = new Set(EVIDENCE.map((e) => e.id));
  const flags = /^[A-Z]{2,3}_[A-Z0-9]+$|^W\d+$|^TOLD$|^@/;
  const known = (k: string) => ids.has(k) || flags.test(k) || k.startsWith('GAP_');
  for (const a of ACTIONS) for (const k of [...a.gives, ...(a.beforeRain ?? []), ...(a.show?.all ?? []), ...(a.need?.any?.[1] ?? [])]) assert.ok(known(k), `${a.id}: ${k}`);
  for (const p of PERSONS) {
    for (const t of p.topics) for (const l of t.lines) for (const g of l.gives ?? []) assert.ok(known(g), `${p.id}.${t.id}: ${g}`);
    for (const r of p.presents ?? []) for (const e of r.ev) assert.ok(ids.has(e), `${p.id} present ${e}`);
  }
});

test('S1 바다에서 출발: 하루 안에 지아를 특정하고, 할머니를 동석시킨 한 장면에서 자백까지 간다', () => {
  let s = newGame();
  s = act(s, 'L10');
  s = act(s, 'L11');
  s = act(s, 'F04');
  assert.ok(s.have.includes('E20s'), '비 오기 전 방파제라 혈흔 시료를 얻는다');
  s = talk(s, 'CM', {}, ['stranger', 'sound']);
  assert.ok(s.have.includes('E24'));
  s = act(s, 'R27');
  s = talk(s, 'JB', {}, ['gj']);
  s = until(s, 'E35');
  s = act(s, 'F01');
  s = act(s, 'F02');
  assert.ok(canSummonSuspect(s, 'JA'));
  s = talk(s, 'JA', { suspect: true, withGrandma: true }, ['press', { ev: 'E25' }, { ev: 'E24' }]);
  assert.ok(s.have.includes('GJ_FALSE'));
  assert.ok(s.have.includes('GJ_BROKEN'));
  assert.ok(s.have.includes('JA_CONF'), '빈틈 두 개에서 지아가 자백한다');
  const q = questionStates(s);
  assert.equal(q.find((x) => x.id === 'Q3')!.state, '증거');
  assert.equal(q.find((x) => x.id === 'Q1')!.state, '진술');
  assert.equal(q.find((x) => x.id === 'Q4')!.state, '진술');
  const end = accuse(s, 'JA', '폭행치사');
  assert.equal(end.ending!.key, 'solved');
  assert.equal(end.ending!.told, false);
});

test('따로 소환 경로: 지아 피의자 → 경자 거짓 자백 → 빈틈 → 지아 자백, 112를 알려 준다', () => {
  let s = newGame();
  s = act(s, 'R20');
  s = act(s, 'F04');
  s = talk(s, 'CM', {}, ['sound']);
  s = act(s, 'R27');
  s = endDay(s);
  assert.ok(s.morning && s.morning[1].includes('통화'), '아침 보고에 기다리는 통화 기록이 나온다');
  s = until(s, 'E35');
  s = talk(s, 'JA', { suspect: true }, ['press']);
  assert.ok(s.have.includes('JA_SUS') && !s.have.includes('GJ_FALSE'));
  s = talk(s, 'GJ', {}, ['jia', { ev: 'E20' }, { ev: 'E35' }]);
  assert.ok(s.have.includes('GJ_BROKEN') && !s.have.includes('JA_CONF'));
  s = endDay(s);
  s = talk(s, 'JA', {}, ['broken', 'tell112']);
  assert.ok(s.have.includes('JA_CONF') && s.have.includes('TOLD'));
  const end = accuse(s, 'JA', '폭행치사');
  assert.equal(end.ending!.key, 'solved');
  assert.equal(end.ending!.told, true);
  assert.equal(end.ending!.questions.find((x) => x.id === 'Q5')!.state, '증거');
});

test('S5 할머니의 자백을 받아들이면 할머니 결말, 근거 없이 지아를 송치하면 증명 못 함', () => {
  let s = newGame();
  s = act(s, 'F04');
  s = talk(s, 'CM', {}, ['sound']);
  s = act(s, 'R27');
  s = until(s, 'E35');
  s = talk(s, 'JA', { suspect: true, withGrandma: true }, ['press', 'accept']);
  assert.ok(s.have.includes('GJ_ACCEPT'));
  assert.equal(accuse(s, 'GJ', '폭행치사').ending!.key, 'grandma');
  assert.equal(accuse(newGame(), 'JA', '살인').ending!.key, 'unproven');
  assert.equal(accuse(newGame(), 'BS', '살인').ending!.key, 'wrong');
});

test('근거가 하나뿐이면 지아를 피의자로 부를 수 없고, 영장도 소명 두 개가 있어야 나온다', () => {
  let s = newGame();
  s = talk(s, 'CM', {}, ['sound']);
  assert.equal(canSummonSuspect(s, 'JA'), false);
  assert.equal(summon(s, 'JA', { suspect: true })[1].ok, false);
  assert.equal(doAction(s, 'W01')[1].ok, false);
  s = talk(s, 'JB', {}, ['gj']);
  assert.ok(doAction(s, 'W01')[1].ok);
});

test('비가 온 뒤 방파제를 보면 혈흔 시료가 없어 DNA 감정이 메뉴에 나오지 않는다', () => {
  let s = newGame();
  s = endDay(endDay(s)); // 12-13 09:00
  s = act(s, 'R30');      // 13:00
  s = act(s, 'F01');      // 14:00 비
  s = act(s, 'F04');
  assert.ok(s.have.includes('E20') && !s.have.includes('E20s'));
  assert.ok(!visibleActions(s).some((a) => a.id === 'L13'));
});

test('이도현은 근거 두 개를 들고 가면 한 번에 끝까지 인정한다', () => {
  let s = newGame();
  s = act(s, 'R28');
  s = talk(s, 'KM', {}, ['evening']);
  s = act(s, 'R26');
  s = until(s, 'E34');
  s = talk(s, 'DH', {}, ['where', { ev: 'E33' }, { ev: 'E34' }]);
  assert.ok(s.have.includes('DH_OK'));
});

test('하루 근무가 끝나면 긴 조사는 내일로 미뤄지고, 기한을 넘기면 미제', () => {
  let s = newGame();
  s = act(s, 'R20'); s = act(s, 'R28'); s = act(s, 'R30'); // 21:00
  assert.equal(doAction(s, 'F04')[1].ok, false);
  for (let i = 0; i < 31 && !s.ending; i++) s = endDay(s);
  assert.equal(s.ending!.key, 'cold');
});

test('AI 없이도 낱말로 지시를 알아듣는다: 여러 조사, 인물, 안 되는 조사', async () => {
  const { wordOrder, sanitizeOrder } = await import('../src/cold/orderParse');
  assert.deepEqual(wordOrder('부검서 자세히 보고 방파제 쪽도 훑어 봐').ids, ['L10', 'F04']);
  assert.deepEqual(wordOrder('옆집 할머니한테 물어봐').ids, ['P:CM']);
  assert.deepEqual(wordOrder('펜션 cctv 없어?').ids, ['N:CCTV']);
  assert.equal(wordOrder('지금까지 정리해 줘').kind, 'summary');
  assert.equal(wordOrder('그거 해').kind, 'clarify');
  // AI 답 검사: 모르는 ID는 버리고, 반장이 숫자·이름을 지어내면 지운다
  assert.deepEqual(sanitizeOrder({ kind: 'order', ids: ['F04', 'X99'], reply: '' }).ids, ['F04']);
  assert.equal(sanitizeOrder({ kind: 'order', ids: ['X99'], reply: '' }).kind, 'clarify');
  assert.equal(sanitizeOrder({ kind: 'chat', ids: [], reply: '문지아가 10시에 나갔어' }).reply, '');
});

test('수사 지시: 한 말에 여러 조사, 이미 한 조사, 선행 자료가 없는 조사, 소환까지 엔진이 처리한다', () => {
  let s = newGame();
  s = runOrder(s, '부검서 자세히, 방파제도', { kind: 'order', ids: ['L10', 'F04'], reply: '' });
  assert.ok(s.have.includes('E03a') && s.have.includes('E20'));
  s = runOrder(s, '부검서 다시', { kind: 'order', ids: ['L10'], reply: '' });
  assert.match(s.orders.at(-1)!.text, /이미 했어/);
  s = runOrder(s, '섬유 대조해', { kind: 'order', ids: ['L14'], reply: '' });
  assert.match(s.orders.at(-1)!.text, /대조할 옷/);
  s = runOrder(s, '펜션 CCTV는?', { kind: 'nope', ids: ['N:CCTV'], reply: '' });
  assert.match(s.orders.at(-1)!.text, /CCTV 없어/);
  s = runOrder(s, '옆집 할머니 만나 봐', { kind: 'order', ids: ['P:CM'], reply: '' });
  assert.equal(s.session?.person, 'CM');
  s = runOrder(s, '지아 피의자로 불러', { kind: 'order', ids: ['P:JA'], reply: '' }, { suspect: true });
  assert.match(s.orders.at(-1)!.text, /근거가 두 개/);
  s = runOrder(s, '정리 좀', { kind: 'summary', ids: [], reply: '' });
  assert.match(s.orders.at(-1)!.text, /아직 안 풀린 것/);
});

test('조사실 자유 대화: 다시 쓴 대사는 검사를 통과할 때만 쓰고, 자료를 말로 들이밀어도 엔진이 판정한다', async () => {
  const { talkTurn, checkVoiced, sanitizeTalk } = await import('../src/cold/talkParse');
  // 숨긴 사실·숫자·다른 인물 이름을 보태면 버린다
  assert.equal(checkVoiced('계모임 끝나고 와서 잤소.', '계모임 끝나고 10시 반쯤 와서 바로 잤소.', '문경자'), '계모임 끝나고 와서 잤소.');
  assert.equal(checkVoiced('11시쯤 와서 잤소.', '계모임 끝나고 10시 반쯤 와서 바로 잤소.', '문경자'), null);
  assert.equal(checkVoiced('지아가 방파제에 있었소.', '', '문경자'), null);
  assert.equal(checkVoiced('저는 모르겠어요.', '', '최말순'), '저는 모르겠어요.');
  let s = newGame();
  s = summon(s, 'CM')[0];
  // 주제: 준비된 답의 증거가 들어오고, 통과한 말투 대사가 보인다
  s = talkTurn(s, '그날 밤에 혹시 무슨 소리 못 들으셨어요?', sanitizeTalk({ kind: 'topic', topic: 'sound', evidence: [], reply: '아유, 10시 조금 넘어서 방파제 쪽에서 여자애가 "거짓말쟁이!" 하고 소리를 지르더라고.\n애들 싸움인 줄 알았지.' }, s));
  assert.ok(s.have.includes('E24'));
  assert.equal(s.session!.log.at(-2)!.text, '그날 밤에 혹시 무슨 소리 못 들으셨어요?');
  assert.match(s.session!.log.at(-1)!.text, /^아유/);
  // 숨긴 낱말을 보탠 대사는 준비된 답으로 바뀐다
  s = summon(s, 'GJ')[0];
  s = talkTurn(s, '그날 밤 뭐 하셨어요?', sanitizeTalk({ kind: 'topic', topic: 'night', evidence: [], reply: '계모임 끝나고 방파제 들렀다 왔소.' }, s));
  assert.match(s.session!.log.at(-1)!.text, /10시 반쯤 와서 바로 잤소/);
  // 없는 주제·가지지 않은 자료는 잡담으로, 잡담 대사도 검사한다
  const t = sanitizeTalk({ kind: 'present', topic: '', evidence: ['E36'], reply: '' }, s);
  assert.equal(t.kind, 'chat');
});

test('피의자 조사에서 근거를 말로 들이밀면 결정적 장면이 시작되고, 빈틈을 말로 대면 지아가 자백한다', async () => {
  const { talkTurn } = await import('../src/cold/talkParse');
  let s = newGame();
  s.have.push('E24', 'E35', 'E25', 'E20');
  s = summon(s, 'JA', { suspect: true, withGrandma: true })[0];
  s = talkTurn(s, '옆집 할머니가 여자애 목소리를 들었대. 그리고 네가 할머니한테 전화했더라.', { kind: 'present', topic: '', evidence: ['E24', 'E35'], reply: '' });
  assert.ok(s.have.includes('GJ_FALSE'), '경자가 끼어들어 거짓 자백');
  s = talkTurn(s, '할머니는 그 시간에 계모임에 계셨잖아요.', { kind: 'present', topic: '', evidence: ['E25'], reply: '' });
  s = talkTurn(s, '혈흔은 방파제 끝이 아니라 계단 셋째 단이었어요.', { kind: 'present', topic: '', evidence: ['E20'], reply: '' });
  assert.ok(s.have.includes('JA_CONF'));
});

test('리뷰 반영: 헛걸음이 길면 반장 힌트, 늦은 소환은 내일 아침으로, 다시 내민 자료는 한 말을 되풀이', async () => {
  const { talkTurn } = await import('../src/cold/talkParse');
  let s = newGame();
  // 힌트: 새 자료 없이 여섯 번 → 방에서 익사 힌트
  for (let i = 0; i < 6; i++) s = runOrder(s, '음', { kind: 'chat', ids: [], reply: '그래.' });
  assert.match(s.orders.at(-1)!.text, /어디서 빠졌을까/);
  // 정리 답에도 힌트·제안이 붙는다
  s = runOrder(s, '정리해 줘', { kind: 'summary', ids: [], reply: '' });
  assert.match(s.orders.at(-1)!.text, /112|빠졌을까/);
  // 최말순: 수상한 사람을 물어도 소리까지 나온다
  s = summon(s, 'CM')[0];
  s = talkTurn(s, '그날 밤 누가 지나가는 거 못 보셨어요?', { kind: 'topic', topic: 'stranger', evidence: [], reply: '' });
  assert.ok(s.have.includes('E24'));
  // 늦은 소환은 내일 아침 첫 일로
  let late = newGame();
  late = act(late, 'R20'); late = act(late, 'R28'); late = act(late, 'R30'); // 21:00
  late = runOrder(late, '오만석 불러', { kind: 'order', ids: ['P:OM'], reply: '' });
  assert.match(late.orders.at(-1)!.text, /내일 아침 첫 일로/);
  late = endDay(late);
  assert.equal(late.session?.person, 'OM');
  assert.ok(late.morning!.some((l) => l.includes('어제 잡아 둔 일')));
  // 다시 내민 자료: 이미 인정한 것은 되풀이, 반응할 게 없는 자료는 이름을 받아 넘긴다
  let d = newGame();
  d.have.push('E33', 'E42');
  d = summon(d, 'DH')[0];
  d = present(d, 'E33')[0];
  d = present(d, 'E33')[0];
  assert.match(d.session!.log.at(-1)!.text, /되풀이한다[\s\S]*들렀습니다/);
  d = present(d, 'E42')[0];
  assert.match(d.session!.log.at(-1)!.text, /^보험 서류…/);
});

test('리뷰 반영: 목록 밖 단골 요청은 막다른 길 자료로 답한다', () => {
  let s = newGame();
  s = runOrder(s, '세단 명의 조회해', { kind: 'order', ids: ['R40'], reply: '' });
  s = until(s, 'E51');
  assert.match(EVIDENCE.find((e) => e.id === 'E51')!.body, /백승철/);
});

test('교착 버그: 할머니 없이 한 번 추궁한 뒤에도 할머니를 앉히면 결정적 장면이 시작되고, 경자에게 손녀 얘기를 꺼내도 거짓 자백이 나온다', async () => {
  const { talkTurn } = await import('../src/cold/talkParse');
  let s = newGame();
  s.have.push('E24', 'E35', 'E25', 'E20');
  s = summon(s, 'JA', { suspect: true, withGrandma: false })[0];
  s = talkTurn(s, '통화 기록이랑 옆집 진술 있어.', { kind: 'present', topic: '', evidence: ['E35', 'E24'], reply: '' });
  assert.ok(s.have.includes('JA_SUS') && !s.have.includes('GJ_FALSE'));
  s = talkTurn(s, '그래도 말 안 할래?', { kind: 'present', topic: '', evidence: ['E24'], reply: '' });
  assert.match(s.session!.log.at(-1)!.text, /할머니한테 물어보세요/);
  // 할머니를 앉히고 다시
  const withGm = talkTurn(summon(s, 'JA', { withGrandma: true })[0], '다시 묻는다. 통화 기록 봐.', { kind: 'present', topic: '', evidence: ['E35'], reply: '' });
  assert.ok(withGm.have.includes('GJ_FALSE'), '할머니가 끼어든다');
  // 따로 경자에게: 손녀 얘기만 꺼내도
  const gj = talkTurn(summon(s, 'GJ')[0], '할머니, 지아를 감싸고 계신 거죠?', { kind: 'chat', topic: '', evidence: [], reply: '' });
  assert.ok(gj.have.includes('GJ_FALSE'));
});
