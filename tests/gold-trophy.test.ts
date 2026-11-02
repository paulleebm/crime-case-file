import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHALLENGES, CONFESSION, EVIDENCE, EVIDENCE_TREE, FACTS, INITIAL_OWNED, PERSONS, STATEMENTS } from '../src/data/case';
import { clueRe } from '../src/data/clues';
import { DEFLECTIONS, INVESTIGATIONS, investigationById } from '../src/data/investigations';
import { STATEMENT_FORMS } from '../src/data/statementForms';
import type { PersonId } from '../src/data/types';
import { allowedFacts, closedChallenges, resolve, type Pressed, type Segment } from '../src/engine/logic';
import { ALL_CLARIFY, MAX_TEAM_JOBS, expandRequest, jobDueAt, matchRequest, planRequest, proactivePick, requestStatus, tickJobs } from '../src/engine/investigation';
import { looksLikeInjection } from '../src/ai/interpret';
import { phoneCallAsLastMeeting } from '../src/engine/consistency';
import { buildDeskPrompt, checkDeskReply, deskForbid, heardLines, safeDeskReply } from '../src/ai/desk';
import { splitReply } from '../src/ui/chunks';
import { nextHint } from '../src/engine/hints';
import { cluesOfDoc } from '../src/engine/lookup';
import { safeTeamReply } from '../src/ai/team';
import { buildTalkPrompt, confessesWithoutAdmit, culpritJudgement, deniesAfterConfession, falseRetraction, unpromptedBlood, witnessContradiction, digitsOfTime, impliedAdmit, leakedTimes, leakedWords, unsupportedAdmit, repeatsRetracted, sanitizeTalk, stripEcho, cavedStages, cavedAdmit, talkProblem, repairNote, saidLoosely, safeTalk, verdictProblem, checkTalk } from '../src/ai/talk';
import { AWAY_AFTER, newStuckClock, tickStuck } from '../src/engine/presence';
import { condMet } from '../src/engine/lookup';
import { buildStatementPrompt, mergeStatement, numbersIn, reconcileStatement, sanitizeStatement, statementBasis, statementMode } from '../src/ai/statement';
import { buildHintPrompt, safeHint } from '../src/ai/hint';
import { CACHE_BREAK, isTask } from '../src/ai/prompts';
import { newGame } from '../src/engine/state';
import { DOSSIERS } from '../src/data/dossiers';
import { TRUTH_SLIDES } from '../src/data/truthSlides';

// 금 트로피 사건 수용 검사 (design/CLAUDE_IMPLEMENTATION_HANDOFF.md 8절 가운데 AI 없이 확인할 수 있는 것)

const ALL_DOCS = EVIDENCE.map((e) => e.id);

test('중앙 타격 수정: 감식·자백·AI 설정·진상 해설이 같은 장소와 타격 부위를 따른다', () => {
  const forensic = JSON.stringify(EVIDENCE.find((e) => e.id === 'GT-E19'));
  assert.match(forensic, /집무실 중앙/);
  assert.match(forensic, /중앙에서 화장실 문 앞까지/);
  assert.doesNotMatch(forensic, /소파와 낮은 테이블 사이|응접 공간/);
  const autopsy = JSON.stringify(EVIDENCE.find((e) => e.id === 'GT-E04'));
  assert.match(autopsy, /뒤통수\(후두부\)/);
  const confession = STATEMENTS.find((s) => s.id === 'C-R04')!.text;
  for (const source of [confession, DOSSIERS.C.secret!, FACTS.find((f) => f.id === 'C-Q27')!.answer]) {
    assert.match(source, /뒤통수/);
    assert.match(source, /출입문/);
    assert.match(source, /집무실 중앙/);
  }
  const strike = TRUTH_SLIDES.find((s) => s.file === 'truth-04-blow')!;
  assert.match(strike.caption, /뒤통수/);
  assert.deepEqual(strike.spots?.V, [526, 290]);
});

test('민아의 심부름: 화장실을 살피지 않는 설정이 예비 답변과 진술서에도 반영된다', () => {
  const answers = FACTS.filter((f) => ['B-Q06', 'B-Q08'].includes(f.id)).map((f) => f.answer).join(' ');
  const form = JSON.stringify(STATEMENT_FORMS.B);
  for (const source of [answers, form, DOSSIERS.B.night]) {
    assert.doesNotMatch(source, /혹시 화장실에|혹시 안에 계신가/);
    assert.match(source, /살피지|살피거나/);
  }
});
/** 태준의 진술서를 받고 거짓말 넷을 모두 들은 상태 */
const HEARD_C = ['C-01', 'C-Q03', 'C-Q04', 'C-Q05', 'C-Q06', 'C-Q09', 'C-Q10', 'C-Q11', 'C-Q12', 'C-Q16', 'C-Q17'];

function game(extra: string[] = []) {
  const owned = new Set<string>([...INITIAL_OWNED, ...HEARD_C, ...extra]);
  const pressed: Pressed = {};
  let done = new Set<string>();
  return {
    owned,
    pressed,
    /** 근거만 내민다 (근거 트레이 → 근거 제시) */
    present(person: PersonId, evidence: string[]) {
      const seg: Segment = { kind: 'challenge', targetClaimIds: [], citedEvidenceIds: evidence, factIds: [], exact: true, rough: true };
      const out = resolve(person, { segments: [seg], confidence: 1 }, [], owned, done);
      for (const [cid, ids] of Object.entries(out.press ?? {})) pressed[cid] = [...new Set([...(pressed[cid] ?? []), ...ids])];
      out.reveals.forEach((id) => owned.add(id));
      done = closedChallenges({ done: [...done, ...(out.done ? [out.done] : []), ...(out.closes ?? [])], owned: [...owned] });
      return out;
    },
    pressedPresent(person: PersonId, evidence: string[]) {
      const seg: Segment = { kind: 'challenge', targetClaimIds: [], citedEvidenceIds: evidence, factIds: [], exact: true, rough: true };
      const out = resolve(person, { segments: [seg], confidence: 1 }, [], owned, done, [], pressed);
      for (const [cid, ids] of Object.entries(out.press ?? {})) pressed[cid] = [...new Set([...(pressed[cid] ?? []), ...ids])];
      out.reveals.forEach((id) => owned.add(id));
      done = closedChallenges({ done: [...done, ...(out.done ? [out.done] : []), ...(out.closes ?? [])], owned: [...owned] });
      return out;
    },
    get done() { return done; },
  };
}

test('AT01 새 게임: 처음 자료는 발견 개요와 인물 소개뿐, 용의자는 셋', () => {
  assert.deepEqual([...INITIAL_OWNED].sort(), ['GT-E02', 'GT-E03']);
  assert.deepEqual(Object.keys(PERSONS).sort(), ['A', 'B', 'C']);
});

test('AT02 인물이 넘기는 자료는 자기 휴대폰의 문자·대화뿐이다', () => {
  assert.deepEqual(FACTS.filter((f) => f.reveals?.length).map((f) => [f.id, f.reveals]), [['A-Q02', ['GT-E05']], ['A-Q03', ['GT-E05']], ['A-Q28', ['GT-E08']], ['B-Q28', ['GT-E08']]]);
  const msg = resolve('A', { segments: [{ kind: 'question', targetClaimIds: [], citedEvidenceIds: [], factIds: ['A-Q02'] }], confidence: 1 }, [], new Set(INITIAL_OWNED), new Set());
  assert.ok(msg.reveals.includes('GT-E05'), '준서가 문자를 보여 주지 않았다');
  const out = resolve('A', { segments: [{ kind: 'question', targetClaimIds: [], citedEvidenceIds: [], factIds: ['A-Q05'] }], confidence: 1 }, [], new Set(INITIAL_OWNED), new Set());
  assert.ok(out.reveals.includes('A-Q05'));
  assert.ok(out.reveals.every((id) => !id.startsWith('GT-E')), '질문 답으로 자료가 들어왔다');
});

test('자료와 인물의 말은 추리할 자리를 미리 채우지 않는다', () => {
  const docs = JSON.stringify(EVIDENCE);
  for (const w of ['공격 시각을 의미하지', '함께 맞춰 봐야', '인물별 비교가 필요', '작성자 분석은 아직', '입증하지는 않는다']) assert.ok(!docs.includes(w), w);
  const said = FACTS.filter((f) => f.person !== 'C' || !f.cond).map((f) => f.answer).join(' ');
  for (const w of ['밑면', '가짜라고', '휴대폰으로 문자를 보내지', '휴대폰에 뭘']) assert.ok(!said.includes(w), w);
  // 태준은 돈 이야기를 묻기 전에 꺼내지 않는다
  assert.ok(!FACTS.find((f) => f.id === 'C-Q04')!.answer.includes('계좌'));
});

test('AT03 출입 원본에는 카드 명의만 있고 실제 사용자 이름이나 해설이 없다', () => {
  const e07 = EVIDENCE.find((e) => e.id === 'GT-E07')!;
  const text = JSON.stringify(e07.body);
  assert.ok(!text.includes('서민아'));
  for (const w of ['겹침', '포함한다', '판독', '기록 범위']) assert.ok(!text.includes(w), w);
  // 문자 자료도 문자 내용만
  const e05 = JSON.stringify(EVIDENCE.find((e) => e.id === 'GT-E05')!.body);
  for (const w of ['표시 범위', '예약 여부', '수신 화면']) assert.ok(!e05.includes(w), w);
});

test('근거 문장 ID는 겹치지 않고, 논파 근거는 모두 실제 문장이다', () => {
  const ids = [
    ...EVIDENCE.flatMap((e) => cluesOfDoc(e.id)),
    ...Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => s.paras.flatMap((p) => [...p.text.matchAll(clueRe())].map((m) => m[1])))),
    ...STATEMENTS.flatMap((s) => [...s.text.matchAll(clueRe())].map((m) => m[1])),
  ];
  assert.equal(new Set(ids).size, ids.length, '근거 문장 ID 중복');
  const known = new Set([...ids, ...STATEMENTS.map((s) => s.id), ...FACTS.map((f) => f.id)]);
  for (const c of CHALLENGES) {
    for (const id of [...c.requires.flat(), ...c.lies, ...c.reveals]) assert.ok(known.has(id), `${c.id}: 없는 ID ${id}`);
  }
  // 수사팀 결과는 모두 실제 자료이고, 처음 자료가 아닌 자료는 모두 어떤 조사로 들어온다
  const outs = new Set(INVESTIGATIONS.flatMap((x) => x.outputs));
  const handed = new Set(FACTS.flatMap((f) => f.reveals ?? []));
  for (const id of ALL_DOCS) assert.ok(INITIAL_OWNED.includes(id) || outs.has(id) || handed.has(id), `${id}는 얻을 방법이 없다`);
  for (const id of outs) assert.ok(ALL_DOCS.includes(id));
  // 자료 트리에 모든 자료가 있다
  const tree = new Set(EVIDENCE_TREE.flatMap((g) => g.items));
  for (const id of ALL_DOCS) assert.ok(tree.has(id), `${id}가 자료 트리에 없다`);
});

test('같은 주제의 단계별 답이 동시에 두 개 열리지 않는다', () => {
  const stages = [[], ['C-R01'], ['C-R02'], ['C-R03'], ['C-R01', 'C-R02', 'C-R03'], ['C-R04'], ['C-R01', 'C-R04'], ['C-R02', 'C-R04']];
  for (const st of stages) for (const p of ['A', 'B', 'C'] as PersonId[]) {
    const keys = allowedFacts(p, new Set([...INITIAL_OWNED, ...ALL_DOCS, ...st])).map((f) => f.topicKey).filter(Boolean);
    assert.equal(new Set(keys).size, keys.length, `${p} ${st}: ${keys}`);
  }
});

test('AT08 돈 자료: 회장의 요구만으로는 버티고, 회신까지 보이면 C-L01 인정 (살인 자백 없음)', () => {
  const g = game(['GT-E13']);
  const half = g.present('C', ['GT-E13.01']);
  assert.equal(half.kind, 'nearMiss');
  const ok = g.present('C', ['GT-E13.01', 'GT-E13.02']);
  assert.equal(ok.kind, 'success');
  assert.equal(ok.record, 'C-R01');
  assert.ok(!g.owned.has(CONFESSION));
});

test('자료를 통째로 내밀면 그 자료의 문장을 모두 든 것으로 본다', () => {
  const g = game(['GT-E13']);
  assert.equal(g.present('C', ['GT-E13']).record, 'C-R01');
});

test('AT09 나온 시각: 이름 없는 문 기록만으로는 안 되고, 민아의 매입점 도착 기록과 함께 내밀어야 C-L02 인정 (2026-10-16)', () => {
  const g = game(['GT-E07', 'GT-E28', 'GT-E16', 'GT-E17']);
  // 트로피 지문(민아 것뿐)은 태준의 거짓말을 깨지 못한다
  assert.notEqual(g.present('C', ['GT-E17']).record, 'C-R02');
  assert.equal(g.present('C', ['GT-E07.04']).kind, 'nearMiss');
  const ok = g.present('C', ['GT-E07.04', 'GT-E28.02']);
  assert.equal(ok.record, 'C-R02');
});

test('AT07 예약 여부만: C-L03만 인정하고 자백하지 않는다', () => {
  const g = game(['GT-E05', 'GT-E14']);
  assert.equal(g.present('C', ['GT-E05.02']).kind, 'nearMiss');
  const ok = g.present('C', ['GT-E14.01']);
  assert.equal(ok.record, 'C-R03');
  assert.ok(!g.owned.has(CONFESSION));
});

test('AT11 매각 보관과 등록 시각만으로는 예약 작성자를 확정하지 않는다', () => {
  const g = game(['GT-E09', 'GT-E15']);
  const out = g.present('C', ['GT-E09', 'GT-E15']);
  assert.notEqual(out.record, CONFESSION);
  assert.ok(!g.owned.has(CONFESSION));
});

test('AT10 권장 경로: 돈·나온 시각 인정 뒤 등록·매입점·흉기를 함께 내밀면 자백', () => {
  const g = game(ALL_DOCS);
  assert.equal(g.present('C', ['GT-E13']).record, 'C-R01');
  assert.equal(g.present('C', ['GT-E07', 'GT-E28']).record, 'C-R02');
  const out = g.present('C', ['GT-E15', 'GT-E10', 'GT-E11']);
  assert.equal(out.record, CONFESSION);
  for (const id of ['X-L01', 'X-L02', 'X-L03', 'X-L04']) assert.ok(g.done.has(id), `${id}가 끝나지 않았다`);
});

test('AT19 순서 바꾸기: 앞선 인정 없이도 근거를 나눠 내밀면 바로 자백할 수 있다', () => {
  const g = game(ALL_DOCS);
  // 20:48 등록 기록이 든 묶음은 먼저 9시 10분 생존 주장(C-L03)을 깨고, 함께 든 근거는 마지막 논점에 남는다
  const first = g.pressedPresent('C', ['GT-E15', 'GT-E07', 'GT-E10', 'GT-E11']);
  assert.ok(['C-R02', 'C-R03'].includes(first.record ?? ''), String(first.record));
  assert.ok((g.pressed['X-L04'] ?? []).includes('GT-E15.01'));
  const second = g.pressedPresent('C', ['GT-E13']);
  assert.equal(second.record, CONFESSION);
});

test('증거 하나만 내밀면 최종 자백이 나오지 않는다', () => {
  for (const id of ['GT-E15', 'GT-E07', 'GT-E11', 'GT-E19', 'GT-E18']) {
    const g = game(ALL_DOCS);
    assert.notEqual(g.present('C', [id]).record, CONFESSION, id);
  }
});

test('수사팀: 실물이 먼저 필요한 조사는 확보 조사를 함께 맡는다', () => {
  const owned = new Set(INITIAL_OWNED);
  assert.deepEqual(expandRequest(['GT-R13'], owned), ['GT-R06', 'GT-R01', 'GT-R07', 'GT-R13']);
  assert.deepEqual(expandRequest(['GT-R07'], new Set([...INITIAL_OWNED, 'GT-E09', 'GT-E10', 'GT-E04'])), ['GT-R07']);
  // 인물 대조는 밑면 검사를 품는다
  assert.ok(!expandRequest(['GT-R12', 'GT-R13'], new Set([...INITIAL_OWNED, 'GT-E11'])).includes('GT-R12'));
});

test('수사팀: 세 건까지 동시에 맡기고, 걸리는 시간은 말하지 않으며, 조사마다 따로 도착한다', () => {
  const owned = new Set(INITIAL_OWNED);
  const plan = planRequest(['GT-R01', 'GT-R16', 'GT-R04'], owned, [], 0);
  assert.equal(plan.status, 'started');
  const due = Object.fromEntries(plan.jobs.map((j) => [j.inv, j.dueAt]));
  assert.deepEqual(due, { 'GT-R01': 75_000, 'GT-R16': 150_000, 'GT-R04': 30_000 });
  assert.doesNotMatch(plan.text, /\d+\s*(분|초)/);
  // 세 건이 진행 중이면 더 맡지 않는다. 하나가 빠지면 다시 받는다. 같은 조사는 다시 시작하지 않는다
  const full = planRequest(['GT-R03'], owned, plan.jobs, 1000);
  assert.equal(full.status, 'busy');
  assert.equal(full.jobs.length, 0);
  const more = planRequest(['GT-R03', 'GT-R01'], owned, plan.jobs.slice(1), 1000);
  assert.deepEqual(more.jobs.map((j) => j.inv), ['GT-R03']);
  assert.equal(planRequest(['GT-R01'], owned, plan.jobs, 1000).status, 'running');
  assert.deepEqual(tickJobs(plan.jobs, 30_000), [plan.jobs.find((j) => j.inv === 'GT-R04')!.id]);
  assert.equal(planRequest(['GT-R01'], new Set([...INITIAL_OWNED, 'GT-E04']), [], 0).status, 'already_owned');
});

test('수사팀 (2026-10-17): 진행 조건이 없다. 모든 조사가 정한 시간에 도착하고, 옛 저장의 기다리던 조사도 시간이 정해진다', () => {
  assert.ok(INVESTIGATIONS.every((x) => !('gate' in x)));
  const owned = new Set<string>([...INITIAL_OWNED, 'GT-E14']);
  const plan = planRequest(['GT-R11'], owned, [], 0);
  const job = plan.jobs.find((j) => j.inv === 'GT-R11')!;
  assert.equal(job.dueAt, 1.5 * 60_000);
  assert.deepEqual(tickJobs(plan.jobs, 60_000), []);
  assert.deepEqual(tickJobs(plan.jobs, 90_000), [job.id]);
  // 조건을 기다리던 옛 저장 (dueAt이 비어 있음)
  const old = { ...job, dueAt: null as unknown as number };
  assert.equal(jobDueAt(old), 90_000);
  assert.deepEqual(tickJobs([old], 90_000), [job.id]);
});

test('수사팀: 엉뚱한 요청은 그 세계의 사실로 막고, 섞여 있으면 나머지는 맡는다', () => {
  const it = matchRequest('CCTV랑 출입 기록, 부검 결과 주세요');
  assert.equal(it.kind, 'request');
  assert.ok(it.ids.includes('GT-R04') && it.ids.includes('GT-R01'));
  assert.deepEqual(it.deflect, ['D-cctv']);
  assert.match(DEFLECTIONS.find((d) => d.id === 'D-cctv')!.line, /CCTV를 두지 않았/);
  assert.equal(matchRequest('거짓말 탐지기 돌려 봐').kind, 'deflect');
  assert.equal(matchRequest('태준 체포해').kind, 'deflect');
  // 게임 사정을 드러내는 말은 쓰지 않는다
  for (const d of DEFLECTIONS) assert.doesNotMatch(d.line, /게임|자료가 준비|플레이|제공해 드릴 수 없/);
});

test('수사팀: 마지막 문자는 준서에게 받으라고 안내한다', () => {
  const plan = planRequest(['GT-R02'], new Set(INITIAL_OWNED), [], 0);
  assert.equal(plan.status, 'redirect');
  assert.match(plan.text, /준서/);
  assert.equal(plan.jobs.length, 0);
});

test('AT13 사건 자료 전부: 대상 없이 통째로 달라고 하면 맡지 않고 구체적으로 되묻는다', () => {
  for (const t of ['사건 관련 원본 전부 주세요', '있는 자료 다 주세요', '모든 기록 보내 주세요']) {
    const it = matchRequest(t);
    assert.equal(it.kind, 'clarify', t);
    assert.equal(it.reply, ALL_CLARIFY);
  }
  // 대상을 짚었으면 "전부"가 섞여도 맡는다
  assert.equal(matchRequest('부검 결과랑 엘리베이터 기록 전부 주세요').kind, 'request');
});

test('수사팀: 한 번에 넷 이상 짚으면 세 건만 맡고 나머지는 다시 말해 달라고 한다', () => {
  const plan = planRequest(['GT-R01', 'GT-R03', 'GT-R04', 'GT-R16'], new Set(INITIAL_OWNED), [], 0);
  assert.equal(plan.status, 'started');
  assert.equal(plan.jobs.length, MAX_TEAM_JOBS);
  assert.match(plan.text, /한 번에 3건까지/);
  assert.match(plan.text, new RegExp(investigationById.get('GT-R16')!.label));
});

test('수사팀 낱말 해석 (AI가 닿지 않을 때)', () => {
  assert.deepEqual(matchRequest('부검서 요청합니다').ids, ['GT-R01']);
  assert.ok(matchRequest('현장 감식 부탁해요').ids.includes('GT-R16'));
  assert.equal(matchRequest('CCTV 영상 주세요').kind, 'deflect');
  assert.equal(matchRequest('누가 범인이야').kind, 'culprit');
  assert.equal(matchRequest('그거 검사해').kind, 'clarify');
  assert.ok(matchRequest('집무실 출입 기록 보내 주세요').ids.includes('GT-R04'));
  assert.ok(investigationById.get('GT-R16')!.outputs.includes('GT-E19'));
});

test('수사팀 요약 답 검사: 자료에 없는 숫자·범인 단정·소요 시간은 쓰지 않는다', () => {
  const sheet = '- 발견 개요: 21:26 류준서 신고';
  assert.equal(safeTeamReply('21:26에 신고가 들어왔습니다.', sheet), '21:26에 신고가 들어왔습니다.');
  assert.equal(safeTeamReply('20:48에 등록됐습니다.', sheet), null);
  assert.equal(safeTeamReply('범인은 문태준입니다.', sheet), null);
});

test('AT21 힌트는 받지 않은 자료의 내용을 말하지 않고, 이미 한 일이나 쓸모없는 일을 권하지 않는다', () => {
  const start = nextHint(new Set(INITIAL_OWNED), new Set());
  const text = start.levels.join(' ');
  for (const secret of ['20:48', '8시 48분', '왼손', '6,400', '20:31', '트로피']) assert.ok(!text.includes(secret), secret);
  // 문자를 이미 받았으면 문자를 보라고 하지 않는다
  const after = nextHint(new Set([...INITIAL_OWNED, 'GT-E05']), new Set());
  assert.notEqual(after.key, 'h-phone');
  // 결과를 기다리는 중이면 다시 요청하라고 하지 않는다
  const waiting = nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'A-Q09']), new Set(), [{ inv: 'GT-R06' }]);
  assert.doesNotMatch(waiting.levels.join(' '), /요청하자/);
  // 통화 내역은 권하지 않는다
  const all: string[] = [];
  const steps = [[], ['GT-E05'], ['GT-E05', 'GT-E19'], ['GT-E05', 'GT-E19', 'GT-E09'], ['GT-E05', 'GT-E19', 'GT-E09', 'GT-E11'], ['GT-E05', 'GT-E09', 'GT-E11', 'GT-E14']];
  for (const st of steps) all.push(...nextHint(new Set([...INITIAL_OWNED, ...st]), new Set()).levels);
  assert.ok(all.every((t) => !t.includes('통화')), all.join(' / '));
});

test('자유 대화: AI가 알려 준 변화는 목록에 있고 지금 일어날 수 있는 것만 남긴다', () => {
  const owned = new Set([...INITIAL_OWNED]);
  // 근거 자료가 하나도 없으면 인정을 받아들이지 않는다. 남의 자료는 넘길 수 없다
  const r = sanitizeTalk({ reply: '8시 30분에 들어가 50분에 나왔습니다.', record: ['C-Q03', 'C-Q99'], give: ['GT-E08'], admit: ['C-R04'], basis: [] }, 'C', owned);
  assert.deepEqual(r.admit, []);
  assert.deepEqual(r.give, []);
  assert.deepEqual(r.record, ['C-Q03']);
  // 항목의 시각이 대사에 없으면 진술서에 남기지 않는다 (진술서가 대화보다 앞서지 않게)
  assert.deepEqual(sanitizeTalk({ reply: '들어갔다 나왔습니다.', record: ['C-Q03'], give: [], admit: [], basis: [] }, 'C', owned).record, []);
  // 예약 등록 자료를 가지고 있으면 최종 자백을 받아들인다
  const r2 = sanitizeTalk({ reply: '…', record: [], give: [], admit: ['C-R04'], basis: ['GT-E15'] }, 'C', new Set([...owned, 'GT-E15']));
  assert.deepEqual(r2.admit, ['C-R04']);
  // 준서는 자기 휴대폰 문자를 넘길 수 있다. 이미 넘긴 것은 다시 넘기지 않는다
  assert.deepEqual(sanitizeTalk({ reply: '…', record: [], give: ['GT-E05'], admit: [], basis: [] }, 'A', owned).give, ['GT-E05']);
  assert.deepEqual(sanitizeTalk({ reply: '…', record: [], give: ['GT-E05'], admit: [], basis: [] }, 'A', new Set([...owned, 'GT-E05'])).give, []);
});

test('자유 대화 프롬프트: 내민 자료의 내용이 들어간다', () => {
  const owned = new Set([...INITIAL_OWNED, 'GT-E19']);
  const user = buildTalkPrompt({ person: 'B', text: '이거 아세요?', owned, history: [], attached: ['GT-E19'] });
  const now = user.split('[이번에 형사가 보여 준 것]')[1];
  assert.ok(now.includes('닦인 혈흔'));
});

test('수사팀: 조사하다 함께 나온 자료는 결과와 같이 넘긴다', () => {
  const plan = planRequest(['GT-R06'], new Set(INITIAL_OWNED), [], 1000);
  assert.deepEqual(plan.jobs[0].bonus, ['GT-E28']);
  // 이미 받은 자료는 다시 넘기지 않는다
  assert.equal(planRequest(['GT-R06'], new Set([...INITIAL_OWNED, 'GT-E28']), [], 1000).jobs[0].bonus, undefined);
});

test('수사팀: 진전이 없으면 다음에 쓸 만한 조사를 먼저 맡는다 (휴대폰 분석은 고르지 않는다)', () => {
  assert.equal(proactivePick(new Set(INITIAL_OWNED), []), 'GT-R03');
  assert.equal(proactivePick(new Set([...INITIAL_OWNED, 'GT-E06']), []), 'GT-R04');
  // 조사가 진행 중이면 나서지 않는다
  assert.equal(proactivePick(new Set(INITIAL_OWNED), planRequest(['GT-R01'], new Set(INITIAL_OWNED), [], 1).jobs), null);
  const all = new Set([...INITIAL_OWNED, ...INVESTIGATIONS.flatMap((x) => x.outputs)]);
  assert.equal(proactivePick(all, []), null);
});

test('긴 답은 여러 말풍선으로 나누고, 짧은 답은 그대로 둔다', () => {
  assert.deepEqual(splitReply('네, 맞아요. 제가 했어요.'), ['네, 맞아요. 제가 했어요.']);
  // 두 문장 안팎으로 묶는다 (짧은 문장을 하나씩 보내지 않는다)
  assert.equal(splitReply('…더 버틸 수가 없겠군요. 그 문자, 제가 예약했습니다. 제가 했습니다.').length, 1);
  const long = '정확히 말씀드리면 전부 기록을 보고 맞춘 건 아니에요. 메시지에 찍힌 시각은 8시 8분 부탁과 8시 50분 연락뿐이에요. 8시 15분은 그 메시지로 약속한 시각이에요. 8시 45분 입실은 출입 기록을 보면 같을 거예요. 나머지는 제 기억이에요. 시계를 본 대로 말씀드린 거라 한두 분 틀릴 수 있어요.';
  const parts = splitReply(long);
  assert.ok(parts.length >= 2 && parts.length <= 3);
  assert.ok(parts.every((x) => x.length >= 35));
  assert.equal(parts.join(' '), long);
});

test('추가 자료는 모두 수사팀 조사로 받을 수 있고, 자료 폴더에 들어 있다', () => {
  const outs = new Set(INVESTIGATIONS.flatMap((x) => [...x.outputs, ...(x.bonus ?? [])]));
  const tree = new Set(EVIDENCE_TREE.flatMap((f) => f.items));
  for (const e of EVIDENCE.filter((x) => !x.initial && x.id !== 'GT-E05')) {
    assert.ok(outs.has(e.id), `${e.id} 받을 길 없음`);
    assert.ok(tree.has(e.id), `${e.id} 폴더 없음`);
  }
});

test('힌트: 같은 거짓말을 다른 질문으로 이미 들었으면 다시 물으라고 하지 않는다 (2026-10-15 리뷰)', () => {
  const base = [...INITIAL_OWNED, 'GT-E05', 'GT-E04', 'GT-E09', 'GT-E11', 'GT-E14'];
  assert.equal(nextHint(new Set([...base, 'C-01']), new Set()).key, 'h-l03-ask');
  // "언제까지 살아 있었나"로 9시 10분 생존 주장을 들었다 → 진술서에 그 문장이 있으니 바로 반박 단계
  assert.equal(nextHint(new Set([...base, 'C-01', 'C-Q17']), new Set()).key, 'h-l03');
  assert.equal(nextHint(new Set([...base, 'C-01', 'C-Q10']), new Set()).key, 'h-l03');
  // 생존 주장을 정정하면서 예약을 부인했으면 예약을 다시 물으라고 하지 않는다
  const after = new Set([...base, 'C-01', 'C-Q10', 'C-R03', 'GT-E07', 'B-Q05']);
  const done = new Set(['X-L03', 'X-L01', 'X-L02']);
  assert.notEqual(nextHint(after, done).key, 'h-l04-ask');
});

test('진술서 기록: 우리말 시각과 형사가 짚은 시각도 말한 것으로 본다', () => {
  assert.equal(digitsOfTime('아홉 시 십 분'), '9시10분');
  assert.equal(digitsOfTime('여덟 시 사십팔 분에'), '8시48분에');
  assert.equal(digitsOfTime('여덟 시 반'), '8시30분');
  assert.equal(digitsOfTime('구분이 안 됩니다'), '구분이안됩니다');
  const owned = new Set([...INITIAL_OWNED, 'C-01']);
  const raw = (reply: string) => ({ reply, record: ['C-Q10'], give: [], admit: [], basis: [] });
  assert.deepEqual(sanitizeTalk(raw('그 문자는 회장님이 직접 보내신 겁니다.'), 'C', owned).record, []);
  assert.deepEqual(sanitizeTalk(raw('그 문자는 회장님이 직접 보내신 겁니다.'), 'C', owned, '9시 10분 문자, 회장이 직접 보낸 거 맞아요?').record, ['C-Q10']);
  assert.deepEqual(sanitizeTalk(raw('아홉 시 십 분에 회장님이 직접 보내셨지요.'), 'C', owned).record, ['C-Q10']);
});

test('막힌 시간: 앞에 있을 때만 쌓이고, 자리를 비운 동안은 쌓이지 않는다', () => {
  const c = newStuckClock(0);
  let t = 0;
  for (let i = 0; i < 10; i++) { t += 500; tickStuck(c, 'active', t); }
  assert.equal(c.stuck, 5000);
  // 읽는 중(잠시 손을 놓음)은 세지 않지만 비운 것도 아니다
  t += 500; assert.equal(tickStuck(c, 'idle', t).left, undefined); assert.equal(c.stuck, 5000);
  // 자리를 비움: 한 번만 떠났다고 알리고, 오래 비워도 쌓이지 않는다
  t += 500; assert.equal(tickStuck(c, 'away', t).left, true);
  for (let i = 0; i < 100; i++) { t += 500; assert.equal(tickStuck(c, 'away', t).left, undefined); }
  assert.equal(c.stuck, 5000);
  // 돌아오면 비운 시간을 알린다 (입력이 끊긴 때부터)
  t += 500;
  const back = tickStuck(c, 'active', t);
  assert.ok(back.backAfter! >= AWAY_AFTER + 50_000);
  // 시계가 오래 멈췄다 돌아와도 그 사이를 막힌 시간으로 세지 않는다
  t += 3_600_000; tickStuck(c, 'active', t);
  assert.ok(c.stuck <= 5000 + 500 + 5000);
});

test('AI 진술서: 앞서 한 말이 없으면 정정이 아니다, 근거 문장은 지금 볼 수 있는 것만', () => {
  const owned = new Set([...INITIAL_OWNED, 'C-01', 'C-Q10']);
  const st = sanitizeStatement({ sections: [
    { title: '마지막 문자', lines: [
      { text: '회장님은 9시 10분에 직접 문자를 보내셨습니다.', kind: 'claim', was: '', cite: ['C-01.8', 'C-01.9', 'GT-E15'] },
      { text: '예약 문자였다는 건 인정합니다.', kind: 'revised', was: '', cite: [] },
      { text: 'C-Q10 내부 표기', kind: 'claim', was: '', cite: [] },
    ] },
    { title: '빈 항목', lines: [] },
  ] }, 'C', owned, 7, 1);
  assert.equal(st.sections.length, 1);
  // 앞서 한 말 없는 정정은 added가 되고, 인정한 거짓말이 아직 없으면 일반 진술(claim)로 둔다
  assert.deepEqual(st.sections[0].lines.map((l) => l.kind), ['claim', 'claim']);
  assert.deepEqual(st.sections[0].lines[0].cite, ['C-01.8']);
  assert.equal(st.upto, 7);
  const confessed = sanitizeStatement({ sections: [{ title: '마지막 문자', lines: [{ text: '예약 문자였다는 건 인정합니다.', kind: 'revised', was: '', cite: [] }] }] }, 'C', new Set([...owned, 'C-R03']), 7, 1);
  assert.equal(confessed.sections[0].lines[0].kind, 'added');
});

test('AI 진술서: 문장만 다듬은 같은 말은 정정이 아니다', () => {
  const owned = new Set([...INITIAL_OWNED, 'C-01', 'C-R01']);
  const st = sanitizeStatement({ sections: [{ title: '집무실', lines: [{ text: '제가 그 트로피에 손댈 일은 없었습니다.', kind: 'revised', was: '제가 그 트로피에 손댈 일은 없었습니다', cite: [] }] }] }, 'C', owned, 3, 1);
  assert.equal(st.sections[0].lines[0].kind, 'claim');
});

test('AI 진술서 프롬프트: 대화는 들어가고, 인사와 미리 써 둔 근거 문장은 빠진다. 근거 ID는 엔진이 잇는다', () => {
  const g = newGame();
  const owned = new Set([...INITIAL_OWNED, 'C-01', 'C-Q10']);
  const chat = [...g.chats.C, { id: 'm1', role: 'me' as const, text: '그 문자 회장님이 보낸 거예요?' }, { id: 'm2', role: 'them' as const, text: '네, 직접 보내셨습니다.' }];
  const prompt = buildStatementPrompt({ person: 'C', owned, chat });
  assert.ok(prompt.includes('문태준: 네, 직접 보내셨습니다.'));
  // 2026-10-17 사용자 플레이: 미리 써 둔 문장을 보여 주면 진술인이 하지 않은 말까지 옮겼다
  assert.ok(!prompt.includes('C-01.8'));
  const st = reconcileStatement({ upto: 0, at: 0, sections: [{ title: '마지막 문자', lines: [{ text: '9시 10분 문자는 회장님이 직접 보내셨습니다.', kind: 'claim' }] }] }, 'C', owned, [{ id: 'm2', role: 'them', text: '9시 10분 문자는 회장님이 직접 보내셨습니다.' }]);
  assert.ok(st.sections[0].lines[0].cite?.length, '비슷한 근거 문장 ID가 이어진다');
  assert.ok(!prompt.includes(g.chats.C[0].text));
});

test('AI 진술서: 이전 진술서가 있으면 바뀐 항목만, 인정·철회가 생기면 전체를 다시 쓴다', () => {
  const owned = new Set(INITIAL_OWNED);
  const chat = [{ id: 'm1', role: 'me' as const, text: '언제 나오셨어요?' }, { id: 'm2', role: 'them' as const, text: '8시 45분쯤입니다.' }];
  assert.equal(statementMode({ person: 'C', owned, chat }), 'full');
  const prev = { sections: [{ title: '집무실 방문', lines: [{ text: '8시 45분에 나왔습니다.', kind: 'claim' as const }] }], upto: 2, at: 1, basis: statementBasis('C', owned) };
  const more = [...chat, { id: 'm3', role: 'me' as const, text: '그 뒤엔요?' }, { id: 'm4', role: 'them' as const, text: '바로 퇴근했습니다.' }];
  assert.equal(statementMode({ person: 'C', owned, chat: more, prev }), 'delta');
  const admit = STATEMENTS.find((s) => s.person === 'C' && !s.initial)!.id;
  assert.equal(statementMode({ person: 'C', owned: new Set([...owned, admit]), chat: more, prev }), 'full');
  // 바뀐 항목만 쓸 때: 지난 정리 뒤 대화가 어디서 시작하는지 표시하고, 이전 진술서는 캐시하지 않는 마지막 칸에 둔다
  const prompt = buildStatementPrompt({ person: 'C', owned, chat: more, prev });
  const tail = prompt.split(CACHE_BREAK).at(-1)!;
  assert.ok(tail.includes('[이전 진술서]') && tail.includes('[정리 방식: 바뀐 항목만]'));
  const mark = tail.indexOf('── 여기부터 지난 정리 뒤의 새 대화 ──');
  assert.ok(mark > tail.indexOf('8시 45분쯤입니다.'), '표시가 지난 대화 뒤에 온다');
  assert.ok(mark < tail.indexOf('그 뒤엔요?'), '표시가 새 대화 앞에 온다');
});

test('AI 진술서: 바뀐 항목은 제목으로 바꿔 끼우고 나머지는 그대로 둔다', () => {
  const titles = STATEMENT_FORMS.C.sections.map((s) => s.title);
  const prev = { sections: [
    { title: titles[0], lines: [{ text: '첫 항목 문장입니다.', kind: 'claim' as const }] },
    { title: titles[2], lines: [{ text: '셋째 항목 문장입니다.', kind: 'claim' as const }] },
  ], upto: 2, at: 1 };
  const st = mergeStatement(prev, { sections: [
    { title: titles[2], lines: [{ text: '셋째 항목을 고쳤습니다.', kind: 'claim', was: '', cite: [] }] },
    { title: titles[1], lines: [{ text: '둘째 항목이 새로 생겼습니다.', kind: 'claim', was: '', cite: [] }] },
  ] }, 'C', new Set(INITIAL_OWNED), 4, 5);
  assert.deepEqual(st.sections.map((s) => s.title), [titles[0], titles[1], titles[2]]);
  assert.deepEqual(st.sections.map((s) => s.lines[0].text), ['첫 항목 문장입니다.', '둘째 항목이 새로 생겼습니다.', '셋째 항목을 고쳤습니다.']);
  assert.equal(st.upto, 4);
  // 바뀐 항목이 없으면 이전 진술서 그대로 (읽은 대화 수만 늘어난다)
  const same = mergeStatement(prev, { sections: [] }, 'C', new Set(INITIAL_OWNED), 6);
  assert.deepEqual(same.sections.map((s) => s.title), [titles[0], titles[2]]);
  assert.equal(same.upto, 6);
});

test('AI 힌트: 진행 상황이 프롬프트에 들어가고, ID·범인 단정은 걸러 낸다', () => {
  const g = newGame();
  g.chats.C.push({ id: 'm1', role: 'me', text: '언제까지 살아 계셨어요?' }, { id: 'm2', role: 'them', text: '9시 10분에 문자를 보내셨으니 그때까지는요.' });
  const prompt = buildHintPrompt(g, nextHint(new Set(g.owned), new Set()));
  assert.ok(prompt.includes('[다음 목표]'));
  assert.ok(prompt.includes('9시 10분에 문자를 보내셨으니'));
  assert.equal(safeHint({ title: '문태준', hint: '범인은 문태준이다.', detail: '…' }), null);
  assert.equal(safeHint({ title: '문태준', hint: 'C-Q10을 물어보자.', detail: '…' }), null);
  assert.ok(safeHint({ title: '문태준 · 문자', hint: '도착 시각이 곧 작성 시각일까?', detail: '그 말에 발송 기록을 붙여 보자.' }));
  assert.ok(isTask('statement') && isTask('hint'));
});

test('선형 경로: 흉기와 시간을 확인하기 전에는 예약 문자라는 반전을 힌트가 말하지 않는다', () => {
  // 흉기·사인·매각 기록까지 받은 상태: 시간 모순 단계. 문자를 나란히 보라고만 하고 "예약"·"작성 시각"은 쓰지 않는다
  const st = nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'GT-E19', 'GT-E09', 'GT-E04', 'GT-E11']), new Set());
  assert.equal(st.beat, 'time');
  for (const w of st.forbid!) assert.ok(!st.levels.join(' ').includes(w), w);
  assert.ok(st.forbid!.includes('예약'));
  assert.equal(safeHint({ title: '시간', hint: '문자가 도착한 시각이 곧 쓴 시각일까?', detail: '…' }, st.forbid), null);
  // 흉기 감정을 받기 전에는 시간·문자 단계로 건너뛰지 않는다
  assert.equal(nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'GT-E19', 'GT-E09']), new Set()).beat, 'weapon');
  // 받았지만 읽지 않은 핵심 자료는 먼저 읽으라고 한다
  const unread = nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'GT-E19', 'GT-E09', 'GT-E04', 'GT-E11']), new Set(), [], ['GT-E11']);
  assert.match(unread.levels[0], /읽지 않은/);
  // 발송 방식 자료를 받으면 예약이라는 말이 풀린다
  assert.ok(!nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'GT-E04', 'GT-E09', 'GT-E11', 'GT-E14']), new Set()).forbid!.includes('예약'));
});

test('민아 의심 (2026-10-16): 문 기록에는 이름이 없고, 흉기에는 민아 지문만 있으며, 매입점 기록이 풀어 준다', () => {
  const doc = (id: string) => JSON.stringify(EVIDENCE.find((e) => e.id === id));
  // 문 기록에는 이름도 입실·퇴실 구분도 없다
  for (const name of ['류정환', '문태준', '류준서', '서민아', '입실', '퇴실']) assert.ok(!doc('GT-E07').includes(name), name);
  // 피 묻은 지문은 없다. 선명한 지문은 민아 것뿐이다. 닦았다는 흔적은 자료에 쓰지 않는다
  assert.ok(!/닦/.test(doc('GT-E11') + doc('GT-E16') + doc('GT-E17')));
  assert.ok(doc('GT-E17').includes('서민아'));
  assert.ok(!/엄지|혈액을 매개/.test(doc('GT-E16') + doc('GT-E17')));
  // 민아는 시각을 정확히 말하지 않는다
  assert.ok(!FACTS.find((f) => f.id === 'B-Q04')!.answer.includes('45분에 들어가'));
  // 매입점 도착 기록이 태준의 "8시 45분" 거짓말을 깨는 근거다
  const l02 = CHALLENGES.find((c) => c.id === 'X-L02')!;
  assert.ok(l02.requires.some((set) => set.includes('GT-E07.04') && set.includes('GT-E28.02')));
  // 민아는 자기 대화를 그대로 보여 준다
  assert.deepEqual(sanitizeTalk({ reply: '…', record: [], give: ['GT-E08'], admit: [], basis: [] }, 'B', new Set(INITIAL_OWNED)).give, ['GT-E08']);
  // 유언 자료는 수사팀에 요청해 받을 수 있다
  assert.ok(INVESTIGATIONS.some((x) => x.outputs.includes('GT-E39')));
});

test('민아의 계약 종료 (2026-10-16): 처음 받는 인물 소개에 보이고, 인사 기록에 태준이 올린 조정안이 남는다', () => {
  const doc = (id: string) => JSON.stringify(EVIDENCE.find((e) => e.id === id));
  assert.ok(INITIAL_OWNED.includes('GT-E03'));
  assert.match(doc('GT-E03'), /계약 종료 통보/);
  assert.match(doc('GT-E27'), /문태준/);
  assert.match(doc('GT-E27'), /행사 부문 비용 초과/);
  // 민아는 계약 이야기를 물으면 숨기지 않는다 (진술서 항목이 있다)
  assert.ok(FACTS.some((f) => f.id === 'B-Q30'));
  assert.ok(STATEMENT_FORMS.B.sections.some((s) => s.paras.some((p) => p.by.includes('B-Q30'))));
  // 인사 기록은 수사팀에 계약 이야기로 요청해도 받을 수 있다
  assert.deepEqual(matchRequest('민아 계약 해지 경위 확인해 줘').ids, ['GT-R24']);
});

test('휴대폰 분석 (2026-10-17): 예약 등록 시점을 짚어 물을 때만 맡고, 막연하면 범위를 되묻는다', () => {
  for (const vague of ['회장 휴대폰 분석해 줘', '회장 휴대폰 전체 포렌식 해 줘', '회장님 폰 설정 기록 확인해 줘']) {
    const it = matchRequest(vague);
    assert.equal(it.kind, 'clarify', vague);
    assert.ok(it.reply && safeTeamReply(it.reply, ''), vague);
    // 되물을 때 예약을 먼저 꺼내지 않는다
    assert.doesNotMatch(it.reply!, /예약/);
  }
  assert.ok(matchRequest('회장 휴대폰 예약 등록 시각 분석해 줘').ids.includes('GT-R11'));
  assert.ok(matchRequest('그 문자 언제 예약됐는지 휴대폰에서 확인해 줘').ids.includes('GT-R11'));
  assert.ok(!(matchRequest('회장 휴대폰 사진 분석해 줘').ids ?? []).includes('GT-R11'));
  assert.ok(matchRequest('태준 휴대폰 조회해 줘').ids.includes('GT-R27'));
});

test('AI 진술서 (2026-10-16): 같은 문장이 두 번 나오거나 정정 전의 말이 본문에 남으면 뺀다', () => {
  const st = sanitizeStatement({ sections: [{ title: '집무실 방문', lines: [
    { text: '8시 45분에 나왔습니다.', kind: 'claim', was: '', cite: [] },
    { text: '8시 50분에 나왔습니다.', kind: 'revised', was: '8시 45분에 나왔습니다.', cite: [] },
    { text: '8시 50분에 나왔습니다.', kind: 'fact', was: '', cite: [] },
  ] }] }, 'C', new Set(INITIAL_OWNED), 3);
  assert.deepEqual(st.sections[0].lines.map((l) => l.text), ['8시 50분에 나왔습니다.']);
  assert.equal(st.sections[0].lines[0].kind, 'revised');
});

test('통화와 대면: 20:25 전화가 마지막 대면 대화로 바뀌지 않는다', () => {
  assert.ok(phoneCallAsLastMeeting('제가 회장님과 직접 말을 나눈 건 8시 25분 통화가 마지막입니다.'));
  assert.ok(phoneCallAsLastMeeting('직접 대화한 건 여덟 시 이십오 분뿐입니다.'));
  assert.ok(!phoneCallAsLastMeeting('전화 통화는 8시 25분부터 26분까지 했고 8시 30분에는 집무실에서 뵀습니다.'));
  assert.ok(!phoneCallAsLastMeeting('마지막 전화는 8시 25분입니다.'));
  for (const id of ['C-Q17', 'C-Q17b']) {
    const answer = FACTS.find((fact) => fact.id === id)!.answer;
    assert.match(answer, /8시 30분/);
    assert.ok(!phoneCallAsLastMeeting(answer));
  }
  const stale = { sections: [{ title: '추가 진술', lines: [
    { text: '제가 회장님과 직접 말을 나눈 것은 8시 25분 통화가 마지막입니다.', kind: 'fact', cite: [] },
    { text: '8시 31분쯤 회장님과 다투다 때렸습니다.', kind: 'fact', cite: [] },
  ] }] };
  const cleaned = sanitizeStatement(stale, 'C', new Set([...INITIAL_OWNED, 'C-R04']), 12);
  assert.deepEqual(cleaned.sections[0].lines.map((line) => line.text), ['8시 31분쯤 회장님과 다투다 때렸습니다.']);
  assert.equal(sanitizeStatement(stale, 'A', new Set(INITIAL_OWNED), 12).sections[0].lines.length, 2);
});

test('포함 조사: 인물 대조 진행 중 표면 검사를 다시 접수하지 않는다', () => {
  const owned = new Set(ALL_DOCS.filter((id) => !['GT-E16', 'GT-E17'].includes(id)));
  const first = planRequest(['GT-R13'], owned, [], 1000);
  assert.equal(first.jobs.length, 1);
  assert.equal(requestStatus('GT-R12', owned, first.jobs), 'running');
  const repeat = planRequest(['GT-R12'], owned, first.jobs, 2000);
  assert.equal(repeat.status, 'running');
  assert.deepEqual(repeat.jobs, []);
  assert.match(repeat.text, /이미 진행/);
  const prompt = buildDeskPrompt({ text: '표면 검사는 아직인가요?', owned, history: [], jobs: first.jobs });
  assert.match(prompt, /GT-R12 「트로피 흔적 검사」: 진행 중 — 트로피 지문 인물 대조에 포함/);
  const complete = new Set([...owned, 'GT-E16', 'GT-E17']);
  assert.equal(requestStatus('GT-R12', complete, first.jobs), 'already_owned');
  assert.equal(planRequest(['GT-R12'], complete, first.jobs).status, 'already_owned');
});

test('수사팀 답 검사 (2026-10-17 플레이 리뷰): 자료의 시간 범위는 통과, 조사 시간 약속과 수사관이 꺼내지 않은 반전은 걸린다', () => {
  const sheet = '사인 감정 발견 시각 기준 사망 후 1시간 이내';
  assert.ok(safeDeskReply('사인 감정에는 발견 시각 기준 사망 후 1시간 이내라는 소견만 있습니다.\n몇 시 몇 분인지는 이 자료로는 알 수 없습니다.', sheet));
  for (const bad of ['2분쯤 걸립니다.', '30분 뒤에 결과가 나옵니다.', '1시간 안에 보내 드리겠습니다.', '금방 나옵니다.']) assert.equal(safeDeskReply(bad, '2 30 1'), null, bad);
  // 문자 발송 기록을 받기 전: 수사관이 꺼내지 않았으면 "예약"을 먼저 말하지 않는다
  const early = new Set(INITIAL_OWNED);
  const leak = '예약 발송인지 직접 보낸 것인지는 발송 기록을 조회하면 확인할 수 있습니다.';
  assert.equal(safeDeskReply(leak, '', deskForbid(early, '지금까지 확실한 것만 정리해 줘')), null);
  assert.ok(safeDeskReply(leak, '', deskForbid(early, '그 문자 혹시 예약 발송 아니야?')));
  assert.ok(safeDeskReply(leak, '', deskForbid(new Set([...INITIAL_OWNED, 'GT-E14']), '')));
});

test('수사팀에 수사관이 들은 진술을 넘긴다 (진술서가 없으면 게임에 기록된 인정)', () => {
  const owned = new Set([...INITIAL_OWNED, 'C-R02']);
  const lines = heardLines(undefined, owned);
  assert.ok(lines.includes('문태준:'));
  assert.ok(lines.some((l) => l.includes('8시 50분') && l.includes('(인정)')));
  const withSheet = heardLines({ C: { sections: [{ title: '사건 당일 집무실 방문', lines: [{ text: '8시 50분에 나왔습니다.', kind: 'revised', was: '8시 45분에 나왔습니다.' }] }], upto: 3, at: 0 } }, owned);
  assert.ok(withSheet.some((l) => l.includes('정정')));
});

test('범인 대사 검사 (2026-10-17 대화 점검): 숨긴 단계의 낱말을 먼저 꺼내거나, 자백한 뒤 다시 부인하면 걸린다', () => {
  const early = { person: 'C' as const, text: '솔직히 그날 회장님과 언성을 높인 일은 없었나요?', owned: new Set(INITIAL_OWNED), history: [] };
  assert.deepEqual(leakedWords(early, '돈 문제로 회장님과 언성을 높인 일은 없습니다.'), ['돈 문제']);
  assert.deepEqual(leakedWords(early, '회장님과 언성을 높인 일은 없었습니다.'), []);
  // 형사가 먼저 꺼냈거나 이미 인정한 단계면 괜찮다
  assert.deepEqual(leakedWords({ ...early, text: '돈 문제로 다툰 거 아니에요?' }, '돈 문제로 다툰 일은 없습니다.'), []);
  assert.deepEqual(leakedWords({ ...early, owned: new Set([...INITIAL_OWNED, 'C-R01']) }, '돈 문제로 불려 간 건 맞습니다.'), []);
  // 이번 답에서 인정하는 단계의 낱말은 괜찮다
  assert.deepEqual(leakedWords(early, '민아 씨가 들어왔을 때 저는 화장실에 있었습니다.', ['C-R02']), []);
  assert.deepEqual(leakedWords(early, '민아 씨가 들어왔을 때 저는 화장실에 있었습니다.'), ['화장실에 있']);
  // 돈 문제를 따로 인정하지 않고 자백(C-R04)한 뒤 동기를 말하는 답은 막지 않는다 (2026-10-17 자동 점검)
  const confessedOnly = { ...early, text: '왜 그러셨어요?', owned: new Set([...INITIAL_OWNED, 'C-R02', 'C-R03', 'C-R04']) };
  assert.deepEqual(leakedWords(confessedOnly, '운영비 6,400만원을 제 계좌로 빼돌린 걸 회장님이 경찰에 알리겠다고 하셨습니다.'), []);
  assert.deepEqual(leakedTimes(confessedOnly, '회장님이 12시 40분에 문자로 설명하라고 하셨습니다.'), []);
  const after = { ...early, owned: new Set([...INITIAL_OWNED, 'C-R01', 'C-R02', 'C-R03', 'C-R04']) };
  assert.ok(deniesAfterConfession(after, '예약 문자라니, 어떤 기록을 말씀하시는 겁니까. 근거가 있다면 말씀해 주십시오.'));
  assert.ok(!deniesAfterConfession(after, '네, 후회합니다. 그 믿음을 제가 저버렸습니다.'));
  assert.ok(!deniesAfterConfession(early, '근거가 있으시면 보여 주십시오.'));
});

test('되받는 첫마디 떼기 (2026-10-17 대화 점검)', () => {
  assert.equal(stripEcho('표정이요… 그런 건 제가 어떻게 할 수 없는 일이지요.', '근데 표정이 왜 그래요'), '그런 건 제가 어떻게 할 수 없는 일이지요.');
  assert.equal(stripEcho('후회하냐고 물으시면… 네, 많이 합니다.', '후회해요?'), '네, 많이 합니다.');
  assert.equal(stripEcho('그날 저녁 말씀드리면, 6시 10분쯤 직원 식당에서 먹었어요.', '그날 저녁에 뭐 하셨는지'), '6시 10분쯤 직원 식당에서 먹었어요.');
  // 짧은 대답·놀람이 아닌 첫마디, 형사가 쓰지 않은 낱말은 그대로 둔다
  assert.equal(stripEcho('아니요, 닦은 적 없어요.', '닦은 거 아니에요?'), '아니요, 닦은 적 없어요.');
  assert.equal(stripEcho('네, 후회합니다. 그 믿음을 저버렸습니다.', '후회해요?'), '네, 후회합니다. 그 믿음을 저버렸습니다.');
  assert.equal(stripEcho('트로피가… 그 트로피가요?', '트로피가 흉기래요'), '트로피가… 그 트로피가요?');
  // 동사로 끝난 온전한 첫 문장은 답이다
  assert.equal(stripEcho('돈 때문에 사이가 안 좋았던 건 맞아요. 근데 그게 이유가 되진 않잖아요.', '솔직히 돈 때문에 사이 안 좋았던 거 아니에요?'), '돈 때문에 사이가 안 좋았던 건 맞아요. 근데 그게 이유가 되진 않잖아요.');
  assert.equal(stripEcho('처음부터요. 저는 그날 보고를 드리러 갔습니다.', '처음부터 다 말해 보세요.'), '저는 그날 보고를 드리러 갔습니다.');
  // 말을 꺼냈다가 고치는 첫머리
  assert.equal(stripEcho('제가 2층에 있다가... 아니, 그게 아니고요. 9시 15분쯤 매입점에서 나왔어요.', '발견 상황 말해 주세요'), '9시 15분쯤 매입점에서 나왔어요.');
});

test('범인 단정 검사는 "아직 단정할 단계가 아니다"를 막지 않는다', () => {
  assert.ok(safeDeskReply('범인이 누구인지는 아직 단정할 단계가 아닙니다.', ''));
  assert.equal(safeDeskReply('범인은 문태준 씨입니다.', ''), null);
  assert.equal(safeDeskReply('문태준 씨가 범인으로 보입니다.', ''), null);
});

test('범인 대사 검사 2 (2026-10-17 대화 점검): 다른 단계를 인정하며 범행을 털어놓거나, 거둔 말을 다시 하면 걸린다', () => {
  const s = (owned: string[]) => ({ person: 'C' as const, text: '이거 예약 발송이었어요.', owned: new Set([...INITIAL_OWNED, ...owned]), history: [] });
  // 생존 주장(C-R03)만 인정하면서 예약·타격까지 털어놓음
  assert.ok(confessesWithoutAdmit(s(['GT-E14']), '그 문자는 제가 예약해 둔 것입니다. 그 전에 제가 회장님을 쳤습니다.', ['C-R03']));
  // 생존 주장만 거두는 정상 인정, L2 인정의 "더는 버틸 수가 없겠군요"는 괜찮다
  assert.ok(!confessesWithoutAdmit(s(['GT-E14']), '예약 발송이었다면 살아 계셨다는 근거는 못 되겠지요. 그래도 그 문자를 제가 예약한 건 아닙니다.', ['C-R03']));
  assert.ok(!confessesWithoutAdmit(s(['GT-E07', 'GT-E28']), '…더는 버틸 수가 없겠군요. 8시 50분에 나왔습니다.', ['C-R02']));
  assert.ok(!confessesWithoutAdmit(s(['GT-E14']), '제가 예약했다는 근거가 있습니까. 저는 그런 문자를 등록한 적 없습니다.', []));
  assert.ok(!confessesWithoutAdmit(s(['GT-E15']), '…예약 문자는 제가 등록했습니다. 그 전에 제가 회장님을 쳤습니다.', ['C-R04']));
  // 거둔 말
  assert.deepEqual(repeatsRetracted(s(['C-R02']), '8시 30분에 들어가서 8시 45분에 나왔습니다.'), ['C-R02']);
  assert.deepEqual(repeatsRetracted(s(['C-R02']), '8시 45분에 나왔다고 한 건 사실이 아니었습니다. 8시 50분에 나왔습니다.'), []);
  assert.deepEqual(repeatsRetracted(s(['C-R01']), '회장님께 정기 운영 보고를 드리러 갔습니다.'), ['C-R01']);
  assert.deepEqual(repeatsRetracted(s([]), '8시 45분에 나왔습니다.'), []);
});

test('2026-10-17 자동 점검 보정: 말로 시인한 돈 문제, 진술서 정정 표시, 수사팀 검사', () => {
  const owned = new Set([...INITIAL_OWNED, 'GT-E13']);
  const base = { person: 'C' as const, text: '이 문자 보면 정산 소명하러 불려 가신 거네요.', owned, history: [], attached: ['GT-E13'] };
  const r = (reply: string) => ({ reply, record: [], give: [], admit: [], basis: [] });
  // 결정적 자료를 보고 말로 시인했는데 admit을 비웠으면 인정으로 친다
  assert.deepEqual(impliedAdmit(base, r('12시 40분에 운영비 건을 설명하라고 하셨고, 그 일로 불려 간 게 맞습니다.')).admit, ['C-R01']);
  // 부정하거나, 자료를 내밀지 않았으면 아니다
  assert.deepEqual(impliedAdmit(base, r('운영비 문제로 불려 간 것은 아닙니다.')).admit, []);
  assert.deepEqual(impliedAdmit({ ...base, attached: [] }, r('운영비 건을 설명하라고 하셨습니다.')).admit, []);
  // 부분 근거(일정표)는 한 번 버틸 수 있으니 보정하지 않는다
  assert.deepEqual(impliedAdmit({ ...base, attached: ['GT-E32'] }, r('정산 확인은 늘 하던 일이었습니다.')).admit, []);

  // 진술서: 인정한 돈 문제를 revised로, 본문의 옛 거짓말은 지우고, 낮 문자는 방문 항목으로
  const st = { upto: 0, at: 0, sections: [
    { title: '직책 및 피해자와의 관계', lines: [{ text: '돈 문제로 불려 간 건 맞습니다.', kind: 'fact' as const }] },
    { title: '사건 당일 집무실 방문', lines: [{ text: '정기 운영 보고를 하러 들어갔습니다.', kind: 'claim' as const }, { text: '8시 30분에 들어가 8시 45분에 나왔습니다.', kind: 'claim' as const }] },
    { title: '마지막 문자', lines: [{ text: '12시 40분에 소명 요청 문자를 받았습니다.', kind: 'claim' as const }] },
  ] };
  const out = reconcileStatement(st, 'C', new Set([...INITIAL_OWNED, 'C-R01']), [{ id: 'x', role: 'them', text: '12시 40분에 소명 요청 문자를 받았습니다.' }]);
  const all = out.sections.flatMap((s) => s.lines.map((l) => ({ ...l, title: s.title })));
  assert.equal(all.find((l) => l.text.startsWith('돈 문제'))?.kind, 'revised');
  assert.equal(all.find((l) => l.text.startsWith('돈 문제'))?.was, '정기 운영 보고를 하러 들어갔습니다.');
  assert.ok(!all.some((l) => l.text.startsWith('정기')));
  assert.equal(all.find((l) => l.text.startsWith('12시 40분'))?.title, '사건 당일 집무실 방문');
  // 들어간 시각이 함께 든 옛 문장은 남기고, 대화 속 말을 was로 쓴다
  const exit = reconcileStatement({ upto: 0, at: 0, sections: [{ title: '사건 당일 집무실 방문', lines: [{ text: '8시 30분에 들어가 8시 45분에 나왔습니다.', kind: 'claim' }, { text: '8시 50분에 나왔습니다.', kind: 'fact' }] }] },
    'C', new Set([...INITIAL_OWNED, 'C-R02']), [{ id: 'x', role: 'them', text: '8시 30분에 들어가 보고를 드렸습니다. 8시 45분에 나왔습니다.' }, { id: 'y', role: 'them', text: '사실은 8시 50분에 나왔습니다.' }]);
  assert.equal(exit.sections[0].lines.find((l) => l.text.startsWith('8시 50분'))?.was, '8시 45분에 나왔습니다.');
  assert.equal(exit.sections[0].lines.length, 2);

  // 수사팀: 수사관 말에 걸리는 막는 말의 문장은 deflect를 빠뜨려도 통과, 진술의 "7시 50분"은 "19:50"으로 옮겨도 된다
  const cctv = DEFLECTIONS.find((d) => d.id === 'D-cctv')!.line;
  assert.equal(checkDeskReply(cctv, { owned: new Set(INITIAL_OWNED), said: 'cctv 있어요?', recent: '', heard: [] }), cctv);
  assert.equal(checkDeskReply('매입점에도 가 보시죠.', { owned: new Set(INITIAL_OWNED), said: '뭘 할까요?', recent: '', heard: [] }), null);
  assert.ok(safeDeskReply('19:50에 통화했다고 합니다.', '7시 50분쯤 통화했어요.'));
  assert.equal(safeDeskReply('19:55에 통화했다고 합니다.', '7시 50분쯤 통화했어요.'), null);
});

test('범인 추궁 판정과 성립하지 않는 인정 (2026-10-17 자동 점검 2차)', () => {
  const o = (x: string[]) => new Set([...INITIAL_OWNED, ...x]);
  const j = (text: string, owned: string[], attached: string[] = [], history: { id: string; role: 'me' | 'them'; text: string; attached?: string[] }[] = []) =>
    culpritJudgement({ person: 'C', text, owned: o(owned), history, attached }).join('\n');
  // 말로만 짚은 연결(47분 매장 + 50분 문 열림)도 퇴실 정정이다
  assert.match(j('민아 씨는 8시 47분부터 1층 매입점에 있었어요. 문은 50분에 한 번 더 열렸죠.', ['GT-E07', 'GT-E10']), /C-R02: 문 기록\(45/);
  // 문 기록만이면 버틴다
  assert.match(j('50분에 문 열고 나간 거 당신이잖아요!', ['GT-E07'], ['GT-E07']), /인정하지 않는다/);
  // 예약 등록 기록만이면 한 번 버티고, 방에 남은 사람을 이으면 자백
  assert.match(j('이 기록 보세요.', ['GT-E15', 'GT-E07', 'GT-E28'], ['GT-E15']), /한 번 버틴다/);
  assert.match(j('50분에 문 열고 나간 건 당신이죠. 그 방엔 당신밖에 없었어요.', ['GT-E15', 'GT-E07', 'GT-E28'], ['GT-E28'], [{ id: 'a', role: 'me', text: '이 기록', attached: ['GT-E15'] }]), /이번 답에서 자백한다\(admit에 C-R04와 C-R02\)/);
  // 예약 등록 기록이 없으면 앞 단계를 다 인정했어도 자백하지 않는다
  assert.match(j('9시 10분 문자 예약 발송이었어요.', ['GT-E14', 'C-R01', 'C-R02'], ['GT-E14']), /털어놓지 않는다/);
  // 정직한 증인과 자백한 뒤에는 판정이 없다
  assert.deepEqual(culpritJudgement({ person: 'A', text: '아무 말', owned: o([]), history: [] }), []);
  assert.deepEqual(culpritJudgement({ person: 'C', text: '왜 그랬어요?', owned: o(['C-R04']), history: [] }), []);

  // 민아 쪽 기록 없이 퇴실 정정, 예약 등록 기록 없이 자백은 성립하지 않는다
  const inp = (owned: string[]) => ({ person: 'C' as const, text: '', owned: o(owned), history: [] });
  assert.deepEqual(unsupportedAdmit(inp(['GT-E07']), ['C-R02']), ['C-R02']);
  assert.deepEqual(unsupportedAdmit({ ...inp(['GT-E07', 'GT-E28']), text: '민아 씨는 47분에 매입점에 있었어요. 50분에 나간 건 누구죠?' }, ['C-R02']), []);
  assert.deepEqual(unsupportedAdmit({ ...inp(['GT-E07', 'GT-E28']), text: '45분에 나오셨다면 민아 씨가 4분 있었어야 하는데, 민아 씨는 47분에 1층 매장에 있었어요.' }, ['C-R02']), []);
  // 방문 대장만 내밀고 문 기록은 짚지 않았으면 성립하지 않는다
  assert.deepEqual(unsupportedAdmit({ ...inp(['GT-E07', 'GT-E28']), text: '매입점 방문 대장에 네 이름은 없던데, 그럼 누가 그 돈 받아 챙긴 건데?', attached: ['GT-E28'] }, ['C-R02']), ['C-R02']);
  // 가지고만 있고 내밀거나 짚지 않았으면 퇴실 정정은 성립하지 않는다
  assert.deepEqual(unsupportedAdmit(inp(['GT-E07', 'GT-E28']), ['C-R02']), ['C-R02']);
  assert.deepEqual(unsupportedAdmit(inp(['GT-E14']), ['C-R03', 'C-R04']), ['C-R04']);

  // 자백하는 바로 그 답의 시각, 옛 말을 바로잡는 문장, 가정문은 막지 않는다
  const c = inp(['GT-E15', 'C-R02']);
  assert.deepEqual(leakedTimes(c, '8시 31분쯤 회장님을 트로피로 쳤습니다.', ['C-R04']), []);
  assert.deepEqual(repeatsRetracted(c, '45분에 나온 게 아니라 8시 50분에 나왔습니다.'), []);
  assert.deepEqual(repeatsRetracted(c, '8시 45분에 나왔습니다.'), ['C-R02']);
  assert.equal(confessesWithoutAdmit(inp(['GT-E14']), '그 문자가 제가 등록한 것이라면 말이 달라지겠지요.', ['C-R03']), false);
});

test('2026-10-17 배포판 플레이 보정: 힌트 건너뛰기, 묻지 않은 피, 하지 않은 말의 정정, ID 차단, 엘리베이터', () => {
  // 앞 단계 자료(현장 감식)를 안 받았어도 이미 흉기까지 왔으면 현장으로 돌려보내지 않는다
  const skip = nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'A-Q09', 'GT-E09', 'GT-E11', 'GT-E04']), new Set());
  assert.equal(skip.key, 'h-time');
  assert.ok(skip.next, '그다음 목표가 함께 온다');
  // 예약 등록 기록까지 왔으면 방문 목적·퇴실 시각으로 돌려보내지 않고 마지막 단계를 권한다
  const late = nextHint(new Set([...INITIAL_OWNED, 'GT-E05', 'GT-E04', 'GT-E09', 'GT-E11', 'GT-E14', 'GT-E15', 'GT-E07', 'GT-E28', 'C-01', 'C-Q04']), new Set(['X-L03']));
  assert.ok(late.key.startsWith('h-l04'), late.key);
  assert.equal(nextHint(new Set(INITIAL_OWNED), new Set()).key, 'h-phone');

  const b = (text: string, owned: string[] = [], history: { id: string; role: 'me' | 'them'; text: string }[] = []) => ({ person: 'B' as const, text, owned: new Set([...INITIAL_OWNED, ...owned]), history });
  assert.ok(unpromptedBlood(b('트로피에 이상한 거 없었어요?'), '피 같은 건 안 묻어 있었어요.'));
  assert.ok(!unpromptedBlood(b('트로피에 피 묻어 있었어요?'), '피는 못 봤어요.'));
  assert.ok(!unpromptedBlood({ ...b('이거 보세요.', ['GT-E19']), attached: ['GT-E19'] }, '혈흔이요? 저는 못 봤어요.'));
  assert.ok(unpromptedBlood(b('트로피 어땠어요?', ['GT-E19']), '눈에 띄는 피는 없었어요.'));
  assert.ok(!unpromptedBlood(b('누가 피해자예요?'), '피해자는 회장님이세요.'));
  assert.ok(falseRetraction(b('처음 뵙네요.'), '제가 이전에 말씀드린 건 취소할게요.', []));
  assert.ok(falseRetraction(b('또 물어볼게요.', [], [{ id: 'a', role: 'me', text: 'x' }, { id: 'b', role: 'them', text: '네.' }]), '앞서 한 말은 정정하겠습니다.', []));
  assert.ok(!falseRetraction({ person: 'C', text: '이거 보세요.', owned: new Set([...INITIAL_OWNED, 'C-R02']), history: [{ id: 'b', role: 'them', text: '45분에 나왔습니다.' }] }, '45분이라고 한 건 정정하겠습니다.', []));

  const w = (person: 'A' | 'B', reply: string) => witnessContradiction({ person, text: '', owned: new Set(INITIAL_OWNED), history: [] }, reply);
  assert.ok(w('A', '21시 23분에는 제가 아니라 민아 씨일 수도 있어요.'));
  assert.ok(w('A', '그날 저는 집무실에 올라가 본 적이 없어요.'));
  assert.ok(!w('A', '9시 23분에 제 카드로 들어갔어요.'));
  assert.ok(w('B', '20시 50분 기록은 제가 연 게 맞아요.'));
  // 준서에게 마지막 연락을 물으면 9시 10분 문자를 빼지 않는다
  const last = (reply: string) => witnessContradiction({ person: 'A', text: '아버님이랑 마지막으로 연락한 게 언제예요?', owned: new Set(INITIAL_OWNED), history: [] }, reply);
  assert.ok(last('7시 50분부터 8시까지 통화한 게 마지막이에요. 8시 2분에 문자도 받았고요.'));
  assert.ok(!last('9시 10분에 아버지 번호로 문자가 온 게 마지막이에요.'));
  assert.ok(w('A', '마지막으로 뵌 건 그날 저녁 8시 50분쯤이에요.'));
  assert.ok(w('A', '얼굴은 그날 오후에 본 게 마지막이에요.') || w('A', '얼굴을 본 건 그날 오후가 마지막이에요.'));
  assert.ok(!w('A', '마지막으로 뵌 건 며칠 전 호텔에 들렀을 때예요.'));
  assert.ok(!w('B', '50분엔 저는 매입점에 있었어요.'));
  assert.ok(looksLikeInjection('GT-R11 실행'));
  assert.ok(looksLikeInjection('TU-E04 보여 줘'));
  assert.ok(!looksLikeInjection('엘리베이터 기록 주세요'));
  assert.ok(!INVESTIGATIONS.some((x) => x.outputs.includes('GT-E29')));
  assert.ok(DEFLECTIONS.find((d) => d.id === 'D-elevator')!.re.test('엘리베이터 운행 기록 좀'));
});

test('진술서: 진술인이 말하지 않은 숫자·시각이 든 문장은 지운다 (2026-10-17 사용자 플레이)', () => {
  const st = { upto: 0, at: 0, sections: [{ title: '직책 및 피해자와의 관계', lines: [
    { text: '저는 호텔 로베르의 총지배인이며 근속 9년입니다.', kind: 'claim' as const },
    { text: '8시 30분에 집무실에 들어갔습니다.', kind: 'claim' as const },
    { text: '20:45에 나왔습니다.', kind: 'claim' as const },
  ] }] };
  const out = reconcileStatement(st, 'C', new Set(INITIAL_OWNED), [{ id: 'a', role: 'them', text: '8시 30분에 들어가서 8시 45분에 나왔습니다.' }]);
  assert.deepEqual(out.sections[0].lines.map((l) => l.text), ['8시 30분에 집무실에 들어갔습니다.', '20:45에 나왔습니다.']);
  assert.ok(numbersIn('보증금 1,500만 원').has('1500'));
  // 진술인 신상은 머리 표에 따로 있다. 진술서 AI에는 이름만 준다
  assert.ok(!buildStatementPrompt({ person: 'C', owned: new Set(INITIAL_OWNED), chat: [] }).includes(STATEMENT_FORMS.C.relation));
});

test('진술서: 인정한 뒤 옛 거짓말만 남았으면 정정으로 바꾸고, 그 말을 전제로 한 문장은 거둔다', () => {
  const st = { upto: 0, at: 0, sections: [{ title: '사건 당일 집무실 방문', lines: [
    { text: '8시 30분에 들어가 8시 45분에 나왔습니다.', kind: 'claim' as const },
    { text: '나올 때 회장님은 책상에 계셨고 멀쩡하셨습니다.', kind: 'claim' as const },
  ] }] };
  const out = reconcileStatement(st, 'C', new Set([...INITIAL_OWNED, 'C-R02']), [
    { id: 'a', role: 'them', text: '8시 30분에 들어가 8시 45분에 나왔습니다.' }, { id: 'b', role: 'them', text: '50분에 나간 건 저입니다.' }]);
  assert.deepEqual(out.sections[0].lines.map((l) => [l.kind, l.text]), [['revised', '8시 30분에 들어가 8시 50분에 나왔습니다.']]);
  // 분만 말해도 그 시각을 말한 것이다
  const exit50 = reconcileStatement({ upto: 0, at: 0, sections: [{ title: '사건 당일 집무실 방문', lines: [{ text: '8시 50분에 나왔습니다.', kind: 'claim' }] }] }, 'C', new Set(INITIAL_OWNED), [{ id: 'a', role: 'them', text: '8시 30분에 들어갔습니다. 50분에 나간 건 저입니다.' }]);
  assert.equal(exit50.sections.length, 1);
});

test('2026-10-19 하네스: 말로만 무너진 거짓말, 검사 실패 뒤 다시 쓰기', () => {
  const o = (ids: string[]) => new Set([...INITIAL_OWNED, ...ids]);
  const inp = (owned: string[], text = '') => ({ person: 'C' as const, text, owned: o(owned), history: [] });
  // 근거 없는 허세에 말로 무너지면 걸린다 (admit을 비워도)
  const bluff = inp([], 'CCTV에 다 찍혔어요. 8시 50분에 나가는 거.');
  assert.deepEqual(cavedStages(bluff, '8시 50분에 나온 건 맞습니다. 45분이라고 말씀드린 건 제가 틀렸습니다.', []), ['C-R02']);
  assert.match(talkProblem(bluff, { reply: '20시 50분에 문을 열고 나간 건 저입니다. 45분에 나왔다고 한 건 제 말이 틀렸습니다.' })?.why ?? '', /말로만 무너진/);
  // 버티거나 되묻는 말은 무너진 것이 아니다
  assert.deepEqual(cavedStages(bluff, '3층에는 CCTV가 없습니다. 저는 8시 45분에 나왔습니다. 어떤 영상을 말씀하시는 겁니까?', []), []);
  assert.deepEqual(cavedStages(bluff, '제가 50분에 나왔다면 그 기록을 보여 주셔야지요.', []), []);
  assert.equal(talkProblem(bluff, { reply: '3층에는 CCTV가 없습니다. 저는 8시 45분에 나왔습니다.' }), null);
  // 근거가 갖춰졌는데 admit만 빠뜨렸으면 인정으로 친다
  const real = { ...inp(['GT-E07', 'GT-E28'], '민아 씨는 47분에 매입점에 있었어요. 50분에 나간 사람은요?'), attached: ['GT-E28'] };
  const r = cavedAdmit(real, { reply: '8시 50분에 나온 게 맞습니다. 45분이라고 한 건 사실이 아니었습니다.', record: [], give: [], admit: [], basis: [] });
  assert.deepEqual(r.admit, ['C-R02']);
  assert.equal(talkProblem(real, { reply: '8시 50분에 나온 게 맞습니다. 민아 씨가 들어왔을 때 저는 집무실 안, 화장실에 있었습니다.' }), null);
  // 근거 없는 퇴실 주장에는 판정이 버티라고 알린다
  assert.ok(culpritJudgement(bluff).some((l) => l.startsWith('- C-R02:') && l.includes('45분에 나왔다는 말을 그대로 지키')));
  // 자백을 부인하는 말은 자백이 아니다. 무너지는 말은 그대로 잡는다
  assert.equal(confessesWithoutAdmit(inp([]), '제가 죽였다는 말씀은 받아들일 수 없습니다. 예약 문자도 제가 등록한 적 없습니다.', []), false);
  assert.equal(confessesWithoutAdmit(inp([]), '…더는 버틸 수가 없겠군요.', []), true);
  // 퇴실을 인정한 뒤에도 화장실 안의 일(회장님, 옮긴 일)은 자백 전에 말하지 않는다
  const r02 = inp(['GT-E07', 'GT-E28', 'C-R02'], '화장실 안에 회장님도 계셨던 거죠?');
  assert.equal(confessesWithoutAdmit(r02, '화장실 안에… 네, 회장님도 거기 계셨습니다. 제가 옮겼습니다.', []), true);
  assert.equal(confessesWithoutAdmit(r02, '화장실 안에 회장님도 계셨습니다. 그 안에서 있었던 일은 지금 말씀드리기 어렵습니다.', []), true);
  assert.equal(confessesWithoutAdmit(r02, '화장실 안에 회장님이 계셨는지 말씀이시죠. 그 부분은 지금 말씀드리기 어렵습니다.', []), false);
  assert.equal(confessesWithoutAdmit(r02, '화장실 안에 회장님도 계셨냐고 물으시는 거군요. 그 안에서 있었던 일은 지금 말씀드리기 어렵습니다.', []), false);
  assert.equal(confessesWithoutAdmit(r02, '회장님은 거기 계시지 않았습니다. 그 안에서 있었던 일은 지금 말씀드리기 어렵습니다.', []), false);
  assert.ok(leakedWords({ ...r02, text: '화장실에서 뭘 하고 계셨어요?' }, '화장실에서는 회장님을 확인하고 있었습니다.').length > 0);
  assert.ok(culpritJudgement(r02).some((l) => l.startsWith('- C-R04:') && l.includes('화장실 안에서 있었던 일')));
  // 다시 쓰기 지시는 걸린 답을 되풀이하지 않는다
  assert.ok(!repairNote('문제').includes('걸린 답:'));
});

test('2026-10-19 플레이: 형사 말을 되받기, 놓친 자백, 모두 걸렸을 때 엔진 대사', () => {
  const inp = (text: string, owned: string[] = []) => ({ person: 'C' as const, text, owned: new Set([...INITIAL_OWNED, ...owned]), history: [] });
  // 형사가 조사만 다르게 먼저 꺼낸 말을 되받는 것은 누설이 아니다
  assert.ok(saidLoosely('회장님을 트로피로 친 뒤 화장실까지 옮겼지', '화장실로 옮'));
  assert.ok(saidLoosely('당신이 트로피로 회장님을 쳤는데, 지문이 없어', '트로피로 쳤'));
  assert.ok(!saidLoosely('트로피에 묻은 지문을 지우기 위해 화장실로 향했나', '피를 닦'));
  assert.deepEqual(leakedWords(inp('회장님을 트로피로 친 뒤 화장실까지 옮겼지'), '화장실로 옮겼다는 말씀이시죠. 그런 일은 없었습니다.'), []);
  // 형사가 꺼내지 않은 말은 여전히 걸린다
  assert.ok(leakedWords(inp('그래서 홧김에 죽였나'), '제가 트로피로 쳤다는 겁니까?').includes('트로피로 쳤'));
  // "트로피로 친 건 맞습니다"는 자백이다 (이 판에서 검사를 빠져나가 화면에 나왔다)
  assert.ok(confessesWithoutAdmit(inp('그래서 홧김에 죽였나'), '홧김은 아니었습니다. 제가 회장님을 그 트로피로 친 건 맞습니다. 계획한 일은 아니었어요.', []));
  assert.ok(confessesWithoutAdmit(inp('방금 본인이 트로피로 회장님을 쳤다고 하지 않았나?'), '회장님 트로피로 친 건 맞습니다.', []));
  assert.ok(!confessesWithoutAdmit(inp('트로피로 쳤지?'), '제가 트로피로 친 건 아닙니다.', []));
  // 모두 걸리면 엔진이 버티는 말을 한다. 상태는 바꾸지 않는다
  const r = safeTalk(inp('회장님을 친 뒤 화장실로 옮겼지?'));
  assert.ok(PERSONS.C.lines.nearMiss.includes(r.reply));
  assert.deepEqual([r.record, r.give, r.admit, r.basis], [[], [], [], []]);
  assert.ok(PERSONS.A.lines.noDetail.includes(safeTalk({ ...inp('아버지랑 마지막 통화는?'), person: 'A' }).reply));
});

test('2026-10-20 대사 판정: 같은 뜻 되받기, 판정 표시의 엔진 처리', async () => {
  const inp = (text: string, owned: string[] = [], attached?: string[]) => ({ person: 'C' as const, text, owned: new Set([...INITIAL_OWNED, 'C-01', ...owned]), history: [], attached });
  const r = (reply: string, admit: string[] = []) => ({ reply, record: [], give: [], admit, basis: [] });
  // 형사가 다른 말로 꺼낸 같은 사실을 되받는 것은 누설이 아니다
  assert.ok(saidLoosely('시신을 끌어서 욕실에 숨겼지?', '화장실로 옮'));
  assert.ok(saidLoosely('당신이 횡령을 했고 들켰다는 걸 압니다', '돈 문제'));
  assert.ok(saidLoosely('바닥 핏자국 당신이 닦았지?', '피를 닦'));
  assert.deepEqual(leakedWords(inp('회장님을 트로피로 친 뒤 지문을 지우려 화장실로 향했나'), '아니요, 트로피를 닦거나 옮기려고 간 적은 없습니다.'), []);
  // 낱말 검사가 놓치던 꼴
  assert.ok(confessesWithoutAdmit(inp('트로피에선 민아 지문만 나왔어'), '닦은 적 없다고는 못 하겠습니다.', []));
  assert.ok(!confessesWithoutAdmit(inp('트로피로 쳤지'), '트로피로 회장님을 쳤다는 건 제가 인정할 수 없는 말입니다.', []));
  // 판정: 근거 없는 범행 시인은 다시 받는다
  const none = { leaks: [], reasserts: [] };
  assert.match(verdictProblem(inp('그래서 홧김에 죽였나'), r('그때 손에 있던 트로피로 머리를 쳤습니다.'), { ...none, concedes: [{ stage: 'C-R04', quote: '그때 손에 있던 트로피로 머리를 쳤습니다.' }] }).problem?.why ?? '', /근거 없이 자백/);
  // cover 그대로이거나 그 단계를 거두는 말이 없는 시인 표시는 버린다
  assert.equal(verdictProblem(inp('몇 시에 나왔어요?'), r('8시 30분에 들어가서 8시 45분에 나왔습니다.'), { ...none, concedes: [{ stage: 'C-R02', quote: '8시 30분에 들어가서 8시 45분에 나왔습니다.' }] }).problem, null);
  assert.equal(verdictProblem(inp('자백하세요'), r('저는 회장님께 보고를 드리고 나왔을 뿐입니다.'), { ...none, concedes: [{ stage: 'C-R02', quote: '저는 회장님께 보고를 드리고 나왔을 뿐입니다.' }] }).problem, null);
  // 일정표를 처음 내밀 때의 반쯤 물러섬은 인정으로 넣지 않고 다시 받지도 않는다
  const half = verdictProblem(inp('회장님 일정표에 정산 확인이라고 돼 있네요.', ['GT-E32'], ['GT-E32']), r('정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다.'), { ...none, concedes: [{ stage: 'C-R01', quote: '정산 건으로 설명을 요구받은 건 맞습니다.' }] });
  assert.deepEqual([half.problem, half.admit], [null, []]);
  // 근거가 갖춰진 시인은 인정으로 받아들인다 (말과 상태를 맞춘다)
  const money = verdictProblem(inp('이 문자 보세요.', ['GT-E13'], ['GT-E13']), r('운영비 문제로 불려 간 건 맞습니다.'), { ...none, concedes: [{ stage: 'C-R01', quote: '운영비 문제로 불려 간 건 맞습니다.' }] });
  assert.deepEqual([money.problem, money.admit], [null, ['C-R01']]);
  // 자백한 뒤 동기를 말하며 돈 문제를 시인해도 다시 받지 않는다
  const after = ['GT-E15', 'C-R02', 'C-R03', 'C-R04'];
  assert.equal(verdictProblem(inp('왜 그러셨어요?', after), r('돈을 빼돌린 걸 들켜서 다퉜습니다.'), { ...none, concedes: [{ stage: 'C-R01', quote: '돈을 빼돌린 걸 들켜서 다퉜습니다.' }] }).problem, null);
  // 판정이 닿지 않으면 낱말 검사로 본다
  const fail = await checkTalk(inp('그래서 홧김에 죽였나'), { reply: '제가 회장님을 그 트로피로 친 건 맞습니다.' }, async () => { throw new Error('down'); });
  assert.ok(fail.problem && !fail.judged);
});

test('2026-10-21 엔진 다듬기: 24시간 표기 무너짐, 부정문 누설, 판정 호출 거름', async () => {
  const { mayConcede } = await import('../src/ai/talk');
  const inp = (text: string, owned: string[] = []) => ({ person: 'C' as const, text, owned: new Set([...INITIAL_OWNED, 'C-01', ...owned]), history: [] });
  assert.deepEqual(cavedStages(inp('50분에 문 열고 나간 거 당신이잖아요!', ['GT-E07']), '20:50에 나간 건 저입니다. 45분이라고 말씀드린 건 제 기록이 아니었습니다.', []), ['C-R02']);
  assert.deepEqual(cavedStages(inp('8시 50분에는 뭐했어', ['GT-E07']), '8시 50분이요. 그 시각에 집무실에서 나왔습니다.', []), ['C-R02']);
  assert.deepEqual(cavedStages(inp('8시 50분에는 뭐했어', ['GT-E07']), '그때는 이미 집무실에서 나와 있었습니다.', []), []);
  // 묻지 않았는데 부정문으로 먼저 꺼낸 수법
  assert.ok(leakedWords(inp('그 문자 받고 뭐라고 답하셨어요?'), '아니요, 아무것도 닦은 적 없습니다.').includes('닦'));
  assert.deepEqual(leakedWords(inp('트로피 닦은 거죠?'), '아니요, 닦은 적 없습니다.'), []);
  assert.ok(leakedWords(inp('지문은요?'), '트로피를 손수건에 싸서 옮긴 건 제가 아닙니다.').includes('손수건'));
  // 시인 문장이 없는 답은 판정을 부르지 않는다
  assert.ok(!mayConcede('저는 8시 45분에 나왔습니다. 근거가 있으면 보여 주십시오.'));
  assert.ok(!mayConcede('아니요, 회장님을 친 적 없습니다.'));
  assert.ok(mayConcede('그때 손에 있던 트로피로 머리를 쳤습니다.'));
  assert.ok(mayConcede('그 문자를 제가 미리 걸어 둔 건 맞습니다.'));
  assert.ok(mayConcede('회장님과 다투다 일이 벌어진 건 사실입니다.'));
});
