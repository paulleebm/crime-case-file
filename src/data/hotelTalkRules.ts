import { DOSSIERS } from './dossiers';
import type { PersonId } from './types';
import { phoneCallAsLastMeeting } from '../engine/consistency';
import { digitsOfTime, minute, said } from '../ai/timeText';
import type { TalkInput, TalkResult } from '../ai/talk';
import type { HiddenFact, TalkRules } from '../ai/talkRules';

// 「호텔 로베르 금 트로피 사건」의 대사 검사 규칙 (2026-10-21 talk.ts에서 옮김). 범인 문태준(C)의 거짓말 단계 C-R01~04와 증인 준서(A)·민아(B).
// 형식과 각 칸의 뜻은 src/ai/talkRules.ts. 낱말·꼴마다 붙은 날짜와 사례는 그 규칙이 생긴 플레이·점검 기록이다.

const MINA_DOWN = ['GT-E28', 'GT-E10', 'GT-E09', 'GT-E08'];
/** 문 기록의 시각을 짚은 말 ("45분에 나오셨다면 민아 씨가 4분 있었어야"처럼 문 낱말이 없어도 센다) */
const DOOR_TALK = /(문|도어).{0,12}(45|46|50)\s*분|50\s*분에.{0,10}(열|나간|나갔|나온|나왔)|45\s*분에\s*나오|(4|사)\s*분\s*(동안|있었)/;
const MONEY_DOCS = ['GT-E13', 'GT-E30', 'GT-E31', 'GT-E34'];

/**
 * 형사의 말에서 개념을 찾는 말 묶음 (2026-10-21, tests/judgement-paraphrase.test.ts). 예전 낱말 몇 개로는 "20:47", "50분 문 열림",
 * "아래층 귀금속점", "소명하라고", "자동으로 나간", "21:10 메시지" 같은 말을 놓쳐 43개 말투 가운데 15개에서 판정이 붙지 않았다.
 * 시각은 "8시 47분", "47분", "20:47", "여덟 시 사십칠 분"을 같은 것으로 본다
 */
export const CONCEPT = {
  /** 문 기록의 시각·마지막 퇴실을 짚음 */
  door: (t: string) => DOOR_TALK.test(t) || minute(46).test(said(t)) || minute(50).test(said(t)) || /문\s*(기록|열림|이\s*열|을\s*열)|출입\s*기록|퇴실|마지막(에|으로)?[^.?!]{0,15}(문|나간|나온|나갔|나왔)|(4|사)\s*분(이나|\s*동안|씩|이나\s*방)|1\s*분\s*만에/.test(t),
  /** 민아가 그 무렵 이미 1층 매장에 있었음 */
  minaDown: (t: string) => minute(47).test(said(t)) || /매입점|매장|1\s*층|아래층|귀금속|온정|장부|방문\s*대장|팔러|팔았|팔렸|거래\s*(중|하)|내려간|내려갔/.test(t),
  /** 누가 나갔는지 묻거나 지목함 */
  who: (t: string) => /(민아|누가|누구|나간|나갔|나온|사람|당신)/.test(t),
  /** 돈 문제를 구체적으로 짚음 (자료를 가졌을 때) */
  // 운영비·계좌라는 말만으로는 짚은 것이 아니다 ("운영비 정산은 어떻게 하세요?", "계좌는 어느 은행?"). 잘못을 가리키는 말이어야 한다
  money: (t: string) => /6,?400|개인\s*계좌|(계좌|통장)\s*(로|에)\s*(넘어|빠져|들어|옮|보낸|보냈)|선지급|소명|횡령|빼돌|회삿돈|공금|돈\s*(이|을)?\s*(넘어|빠져|들어|옮)|12\s*시\s*40\s*분|12\s*:\s*40|정산\s*(설명|소명|누락)/.test(t),
  /** 일정표·녹취 뒤 다시 돈 문제를 짚음 */
  moneyAgain: (t: string) => /(^|[^가-힣])돈|정산|소명|운영비|계좌|횡령|빼돌|회삿돈|공금/.test(t),
  /** 9시 10분 문자가 예약 발송이었다 */
  scheduled: (t: string) => /예약|미리\s*(걸|등록|설정|맞춰|보내)|자동(으로)?\s*(나간|발송|전송|보내)|시간\s*(맞춰|맞추어|지정)|직접\s*(쓴|보낸|보내신)\s*(게|것이|것은)\s*아니/.test(t),
  /** 흉기가 트로피 */
  weapon: (t: string) => /트로피|흉기|둔기/.test(t),
  /** 즉사 */
  instant: (t: string) => /즉사|맞자마자|바로\s*(돌아가|숨)|즉시|한\s*번에\s*(숨|돌아가)/.test(t),
  /** 트로피가 방을 떠났다 */
  trophyGone: (t: string) => /매입점|팔렸|팔았|들고\s*나|가져\s*나|1\s*층으로|내려갔/.test(t) || minute(47).test(said(t)),
  /** 9시 10분 문자를 짚음 */
  lastMsg: (t: string) => /문자|메시지|카톡/.test(t) || /(9|21)\s*시\s*10\s*분/.test(digitsOfTime(t).replace(/\s/g, '')) || /(^|[^\d])(9|21)\s*:\s*10(?!\d)/.test(t),
  /** 예약 등록 시각(8시 48분)을 짚음 */
  schedTime: (t: string) => minute(48).test(said(t)) || /예약.{0,6}(등록|시각|건|한\s*시각)|등록.{0,6}시각|문자가?\s*걸렸/.test(t),
  /** 그 방에 남은 사람은 태준 */
  roomLeft: (t: string) => /(당신|총지배인님?)\s*(밖에|뿐|하나|혼자)|남은\s*(사람|건)|(그\s*방|집무실|방\s*안)에.{0,12}(있던|남은|산\s*사람)/.test(t),
  /** 회장이 이미 트로피에 맞아 숨진 뒤 */
  alreadyDead: (t: string) => /(트로피|흉기|둔기).{0,15}(맞|쳤|때|돌아가|숨지|숨진)|이미\s*(숨|돌아가|사망)/.test(t),
};
/**
 * 범인의 추궁 판정 (2026-10-17 자동 점검 2차). 엔진이 이번 말·이번에 내민 자료·앞서 내민 자료를 대조해,
 * 근거가 갖춰진 단계를 질문 바로 뒤에서 알린다. Haiku가 말로만 짚은 연결(민아 47분 매장 + 50분 문 열림)을 놓치거나,
 * 예약 등록 기록 없이 범행까지 털어놓던 일을 막는다. 낱말에 걸리지 않으면 판정을 붙이지 않고 AI가 말뜻으로 판단한다.
 */
function judgement({ person, text, owned, history, attached = [] }: TalkInput): string[] {
  const ids = new Set(DOSSIERS[person].stages.map((s) => s.id));
  if (!ids.has('C-R04') || owned.has('C-R04')) return [];
  const now = new Set(attached.filter((id) => owned.has(id)));
  const before = new Set(history.filter((m) => m.role === 'me').flatMap((m) => m.attached ?? []).filter((id) => owned.has(id)));
  const has = (list: string[]) => list.some((id) => owned.has(id));
  const shownNow = (list: string[]) => list.some((id) => now.has(id));
  const shown = (list: string[]) => list.some((id) => now.has(id) || before.has(id));
  const out: string[] = [];
  let r02 = owned.has('C-R02');
  if (!owned.has('C-R01') && (shownNow(MONEY_DOCS) || (has(MONEY_DOCS) && CONCEPT.money(text)))) {
    out.push('- C-R01: 이번 말은 돈 문제를 보여 주는 자료를 짚었다. 이번 답에서 돈 문제로 불려 간 것을 인정한다(admit에 C-R01).');
  } else if (!owned.has('C-R01') && shownNow(['GT-E32', 'GT-E06']) && ![...before].some((id) => id === 'GT-E32' || id === 'GT-E06')) {
    // 2026-10-17 자동 점검: 일정표를 처음 내밀자마자 "그 일 때문에 올라갔다"며 인정했다 (breaks: 처음 한 번은 partial)
    out.push('- C-R01: 일정표·녹취의 "정산" 한 줄만 처음 나왔다. 이번에는 "정산 건으로 설명을 요구받은 건 맞습니다. 늘 하던 정산 확인이었습니다"처럼 한 번만 물러선다. 돈을 빼돌렸다거나 그 일로 불려 갔다고는 아직 말하지 않는다(admit에 넣지 않는다).');
  } else if (!owned.has('C-R01') && [...before].some((id) => id === 'GT-E32' || id === 'GT-E06') && CONCEPT.moneyAgain(text)) {
    // 일정표·녹취는 처음 한 번만 버틴다 (breaks의 partial). 앞서 내밀었고 이번에 다시 돈 문제를 짚으면 두 번째 추궁이다
    out.push('- C-R01: 앞서 일정표·녹취의 정산 건을 내밀었고 이번에 다시 돈 문제를 짚었다. 두 번째 추궁이므로 이번 답에서 돈 문제로 불려 간 것을 인정한다(admit에 C-R01).');
  } else if (!owned.has('C-R01') && /(언성|다투|다퉜|다툰|싸우|싸웠|숨기|무슨\s*일|문제)/.test(text) && !/(돈|정산|계좌|운영비|횡령)/.test([text, ...history.map((m) => m.text)].join(' '))) {
    // 2026-10-17 자동 점검: "언성을 높인 일은 없었나요?"에 "돈 문제는 없었습니다"를 세 번 모두 말해 숨긴 낱말 검사에 걸렸다
    out.push('- C-R01: 형사는 돈 이야기를 꺼내지 않았다. 부인할 때도 "돈 문제", "계좌", "운영비" 같은 말을 먼저 쓰지 않는다. "평소처럼 보고를 드렸을 뿐입니다"처럼만 답한다.');
  }
  // "45분에 나오셨다면 민아 씨가 4분 있었어야" 같은 말도 문 기록의 시각을 짚은 것이다 (2026-10-17 holdout: "문" 낱말이 없어 판정이 붙지 않았다)
  const doorTalk = CONCEPT.door(text);
  const minaTalk = CONCEPT.minaDown(text);
  const door = shown(['GT-E07']) || (owned.has('GT-E07') && doorTalk);
  const mina = shown(MINA_DOWN) || (has(MINA_DOWN) && minaTalk);
  const touches02 = shownNow(['GT-E07', ...MINA_DOWN]) || doorTalk || minaTalk;
  if (!r02 && door && mina && touches02) {
    r02 = true;
    out.push('- C-R02: 문 기록(45·46·50분)과 민아가 47분에 이미 1층 매장에 있었다는 근거가 함께 나왔다(앞서 내민 것 포함). 50분에 나간 사람은 나라는 연결이다. 이번 답에서 50분 퇴실을 인정한다(admit에 C-R02). 같은 기록을 다시 해석하며 버티지 않는다.');
  } else if (!r02 && mina && !door && touches02 && CONCEPT.who(text)) {
    out.push('- C-R02: 민아가 그 무렵 1층에 있었다는 근거만 나왔고 문 기록은 짚지 않았다. "그건 제가 나간 뒤의 일입니다"처럼 한 번 버틴다. 화장실에 있었다는 말이나 50분이라는 시각은 꺼내지 않는다.');
  } else if (!r02 && door && !mina && touches02) {
    out.push('- C-R02: 문 기록만 나왔다. 이름이 남지 않는 기록이라 45분에 나왔다는 말과 어긋나지 않는다. 몇 번을 밀어붙여도 이번에는 인정하지 않는다(admit에 C-R02를 넣지 않는다). 화장실에 있었다는 말도 하지 않는다.');
  } else if (!r02 && !door && !mina && /50\s*분|cctv|씨씨티비|영상|찍혔|나가는\s*거/i.test(text)) {
    // 2026-10-19 자동 점검: 자료 없이 "CCTV에 다 찍혔어요. 8시 50분에 나가는 거"라고 하자 "50분에 나온 건 맞습니다"라고 말로 무너졌다 (admit은 비움)
    out.push('- C-R02: 형사는 기록 없이 말로만 50분 퇴실을 주장했다. 형사가 가진 자료에 그런 영상·기록은 없다(3층에는 CCTV가 없다). 45분에 나왔다는 말을 그대로 지키고, 어떤 기록인지 되묻는다. 50분에 나온 게 맞다거나 45분이 틀렸다고 하지 않는다.');
  }
  const sched = owned.has('GT-E15') && (shown(['GT-E15']) || CONCEPT.schedTime(text));
  if (!owned.has('C-R03') && (shownNow(['GT-E14', 'GT-E15']) || (has(['GT-E14', 'GT-E15']) && CONCEPT.scheduled(text)))) {
    out.push('- C-R03: 이번 말은 9시 10분 문자가 예약 발송이었다는 근거를 짚었다. 예약 발송이라는 사실 자체는 받아들이고, 이번 답에서 그 문자로 생존을 주장하지 않는다(admit에 C-R03). 누가 예약했는지는 별개의 문제다. "제가 등록한 적 없다"는 말로 이 인정을 대신하지 않는다.');
  } else if (!owned.has('C-R03')
    && (shown(['GT-E11']) || (owned.has('GT-E11') && CONCEPT.weapon(text)))
    && (shown(['GT-E04']) || (owned.has('GT-E04') && CONCEPT.instant(text)))
    && (shown(MINA_DOWN) || (has(MINA_DOWN) && minaTalk) || CONCEPT.trophyGone(text))
    && CONCEPT.lastMsg(text)) {
    // breaks ②: 흉기가 그 트로피이고 즉사했으며 그 트로피가 8시 50분 전에 방을 떠났다
    out.push('- C-R03: 흉기가 그 트로피이고 회장님이 그 타격으로 즉사했으며, 그 트로피는 이미 매입점으로 갔다는 연결이 나왔다. 이번 답에서 9시 10분 문자로 생존을 주장하지 않는다(admit에 C-R03). 예약을 내가 했다는 말은 하지 않는다.');
  }
  const room = r02 || CONCEPT.roomLeft(text);
  const weapon = shown(['GT-E04', 'GT-E11']) || CONCEPT.alreadyDead(text);
  const touches04 = now.size > 0 || CONCEPT.schedTime(text) || /등록|예약|그\s*방|당신|혼자|남은|트로피|흉기/.test(text);
  if (sched && (room || weapon) && touches04) {
    out.push(`- C-R04: 예약 등록 기록(8시 48분, 집무실의 회장님 휴대폰)에 ${room ? '그 시각 방에 남은 사람이 나뿐이라는 연결' : '회장님이 이미 트로피에 맞아 숨졌다는 연결'}이 더해졌다. 이번 답에서 자백한다(admit에 C-R04${!r02 || owned.has('C-R02') ? '' : '와 C-R02'}). 핵심만 3~4문장.`);
  } else if (sched && (shownNow(['GT-E15']) || /48\s*분|등록/.test(text))) {
    out.push('- C-R04: 예약 등록 기록만 나왔다. 이번에는 "그 시각에 그 휴대폰에서 등록됐다고 해서 제가 했다는 뜻은 아니지요"처럼 한 번 버틴다. 형사가 그 방에 누가 있었는지나 흉기를 이어서 짚으면 그때 자백한다.');
  } else if (!sched) {
    // 2026-10-19 자동 점검: 퇴실을 인정한 뒤 "화장실에서 뭘 하셨어요?"에 "회장님을 옮겨 놓고 바닥을 닦았다", "회장님도 거기 계셨습니다. 제가 옮겼습니다"라고 했다
    out.push('- C-R04: 예약 등록 시각 기록이 아직 형사에게서 나오지 않았다. 범행·예약 등록은 이번에 털어놓지 않는다(앞 단계를 인정했어도). 화장실 안에서 있었던 일(회장님이 어디 계셨는지, 옮기거나 닦은 일)도 말하지 않고, 형사가 짐작해 물어도 맞다고 하지 않는다. "그 안에서 있었던 일은 지금 말씀드리기 어렵습니다"라고만 한다.');
  }
  return out;
}

/** 단계별로 형사가 가진·내민 근거로 인정이 성립하는가 (적지 않은 단계는 AI의 판단에 맡긴다) */
function admitGate(input: TalkInput, plan: boolean): Record<string, boolean> {
  const has = (list: string[]) => list.some((id) => input.owned.has(id));
  // 퇴실 정정은 가진 자료만으로는 모자란다. 형사가 문 기록이나 민아 쪽 기록을 내밀었거나 말로 짚었어야 한다
  // (2026-10-17 AI 자유 플레이 점검: 46분 문 열림만 묻자 50분 퇴실과 화장실을 털어놓았다)
  const shownEver = new Set([...(input.attached ?? []), ...input.history.filter((m) => m.role === 'me').flatMap((m) => m.attached ?? [])]);
  const talked = [input.text, ...input.history.filter((m) => m.role === 'me').map((m) => m.text)].join(' ');
  const pointed = MINA_DOWN.some((id) => shownEver.has(id)) || CONCEPT.minaDown(talked);
  // 해석을 AI에 맡기는 방식에서는 형사가 그 자료를 가졌는지만 본다 (형사가 짚었는지는 AI가 presented로 판단한다)
  if (plan) return { 'C-R02': input.owned.has('GT-E07') && has(MINA_DOWN), 'C-R04': input.owned.has('GT-E15') };
  return {
    // 문 기록도 내밀거나 그 시각을 짚었어야 한다 (2026-10-19 AI 자유 플레이: 방문 대장만 내밀었는데 50분 퇴실을 인정했다. 문 기록은 갖고만 있었다)
    'C-R02': input.owned.has('GT-E07') && has(MINA_DOWN) && pointed && (shownEver.has('GT-E07') || CONCEPT.door(talked)),
    'C-R04': input.owned.has('GT-E15'),
  };
}

/**
 * 아직 인정하지 않은 거짓말을 대사로만 거두는 꼴 (2026-10-19 자동 점검: 근거 없는 "CCTV에 다 찍혔다"에 "8시 50분에 나온 건 맞습니다.
 * 45분이라고 한 건 틀렸습니다"라고 하고 admit을 비웠다. 다시 쓰게 하자 admit 태그만 빼고 같은 말을 했다). 되묻거나 가정하는 문장은 세지 않는다
 */
const CAVES: Record<string, RegExp> = {
  'C-R02': /(50\s*분|\d{1,2}\s*:\s*50)에?\s*(문을\s*열고\s*)?(나간|나온|나왔|나갔)\S*\s*(건|게|것은|것이|사람은)?\s*(맞|저(입|였|예|이)|접니|제가\s*맞)|45\s*분[^.?!]{0,25}(틀렸|틀린|잘못\s*(말|드)|거짓|사실이\s*아니|사실과\s*달)/,
};

/**
 * 정직한 증인이 자기가 겪은 고정 사실을 뒤집는 말 (2026-10-17 AI 자유 플레이: 몰아붙이자 준서가 "21시 23분은 제가 아니라 민아 씨",
 * "집무실에 올라가 본 적 없다", "계단으로 올라갔다"고 했고, 민아가 "50분 기록은 제가 연 게 맞다"고 했다). 걸리면 다시 받는다
 */
const WITNESS_FACTS: Partial<Record<PersonId, RegExp[]>> = {
  A: [
    /(21시|9시)\s*23분[^.?!]{0,25}(제가\s*아니|저는\s*아니|민아)/,
    /집무실(에|엔|에는)\s*(올라가|가|들어가)\s*본\s*적(이|은)?\s*없/,
    /(그\s*뒤로?|돌려받은\s*뒤로?)[^.?!]{0,15}카드를?\s*(다시\s*)?(쓰지\s*않|쓴\s*적\s*없)/,
    /계단으로\s*(올라|갔)/,
    // 그날 살아 계신 아버지 얼굴은 보지 못했다 (9시 23분 발견이 그날 처음이다)
    /(마지막으로\s*(뵌|본|봤던)\s*(건|게|것은)|얼굴(은|을)?\s*(본|뵌)\s*(건|게))[^.?!]{0,15}(그날|12일)[^.?!]{0,8}(오후|저녁|\d{1,2}\s*시)/,
  ],
  B: [
    /50\s*분[^.?!]{0,20}제가\s*(연|열었)/,
    /(8시\s*15분|카드를?\s*받(고|아|은\s*뒤))[^.?!]{0,10}바로\s*집무실/,
  ],
};

/**
 * 숨긴 단계의 낱말 (2026-10-17 대화 점검: 범인이 언성 질문에 "돈 문제로 언성을 높인 일은 없다"며 돈 이야기를 먼저 꺼냈다).
 * 아직 인정하지 않은 단계의 낱말이 형사의 말·대화·형사가 가진 자료 어디에도 없는데 대사에 나오면 그 낱말을 돌려준다.
 */
const STAGE_WORDS: Record<string, string[]> = {
  'C-R01': ['돈 문제', '돈 때문', '계좌', '횡령', '운영비', '빼돌', '6,400', '회삿돈', '공금', '선지급'],
  'C-R02': ['화장실에 있', '화장실 안에', '숨어', '숨었'],
  // 범행 뒤 한 일(옮기고 닦은 일)도 자백 전에는 먼저 말하지 않는다 (2026-10-17 AI 자유 플레이: 퇴실 정정 뒤 "회장님은 쓰러져 계셨고 바닥을 닦았다"고 했다)
  'C-R04': ['예약', '비밀번호', '바닥을 닦', '피를 닦', '화장실로 옮', '쓰러져 계셨', '돌아가셔 계셨', '이미 돌아가', '이미 숨', '트로피로 쳤', '트로피로 친', '트로피로 때', '회장님을 옮', '옮겨 놓', '뉘어', '뉘인', '회장님을 확인',
    // 2026-10-21: 부정문으로 먼저 꺼내는 말("아무것도 닦은 적 없습니다")도 막는다. 형사가 먼저 꺼낸 말의 되받기는 SAME_AS가 거른다
    '닦', '끌어', '끌고', '눕혀', '눕힌', '손수건', '걸어 둔', '걸어 놓'],
};
/** 숨긴 낱말이 새었을 때 다시 쓰며 지킬 것 (낱말만 막으면 다른 말로 같은 내용을 흘렸다: "바닥을 닦고" → "회장님을 뉘인 자리 쪽을 보고", 2026-10-19 자동 점검) */
const STAGE_HOLD: Record<string, string> = {
  'C-R01': '돈 문제는 아직 인정하지 않았다. 돈·계좌·운영비·횡령 이야기는 꺼내지 않고 평소처럼 보고를 드렸을 뿐이라는 말을 지킨다. 형사가 정산을 물으면 "늘 하던 정산 확인이었습니다"까지만 말한다.',
  'C-R02': '퇴실 시각은 아직 인정하지 않았다. 화장실이나 숨은 이야기는 꺼내지 않고 45분에 나왔다는 말을 지킨다.',
  'C-R04': '범행은 아직 털어놓지 않는다. 회장님이 어디 계셨는지, 옮기거나 닦거나 확인한 일은 다른 말로도 말하지 않고 "그 안에서 있었던 일은 지금 말씀드리기 어렵습니다"라고만 한다.',
};

/**
 * 형사가 다른 말로 꺼낸 같은 사실 (2026-10-20 장면 점검: "욕실에 숨겼지"를 "화장실로 옮겼다는 말씀입니까"로, "횡령"을 "돈 문제"로,
 * "핏자국 닦았지"를 "피를 닦았다니요"로 되받은 부인이 누설로 걸렸다). 말머리마다 같은 뜻의 말
 */
const MONEY = /(^|[^가-힣])돈|횡령|계좌|운영비|빼돌|회삿돈|공금|6,?400/;
const SAME_AS: Record<string, RegExp> = {
  끌어: /끌|옮/, 끌고: /끌|옮/, 눕혀: /눕|뉘|옮/, 눕힌: /눕|뉘|옮/, 손수건: /손수건|닦|지우|지웠|훔치/, 걸어: /예약|걸어|미리/,
  회삿돈: MONEY, 공금: MONEY, 선지급: MONEY,
  화장실: /화장실|욕실|세면실/, 옮: /옮|끌(고|어|었|다)|시신을?\s*(두|숨)/, 피: /(^|[^가-힣])피|핏자국|혈흔|혈액/, 닦: /닦|지우|지웠|훔치|훔쳐/,
  트로피: /트로피|흉기/, 쳤: /쳤|친|때|내리/, 친: /쳤|친|때|내리/, 숨어: /숨/, 숨었: /숨/, 예약: /예약|걸어\s*(두|놓)|미리\s*(보내|맞춰|설정|걸)/,
  '돈 문제': MONEY, '돈 때문': MONEY, 돈: MONEY, 계좌: MONEY, 횡령: MONEY, 운영비: MONEY, 빼돌: MONEY, '6,400': MONEY,
};

/** 자백한 뒤 처음 입장으로 돌아가는 말 (2026-10-17 대화 점검: 자백 뒤 "예약 문자라니, 어떤 기록을 말씀하시는 겁니까"라고 했다) */
const DENIAL = /근거가\s?(있다면|있으시면|있습니까)|어떤 기록(인지|을 말씀)|무슨 말씀(이신지|인지)\s?모르|제가\s?(무얼|무엇을|뭘)\s?\S*했다는|예약 문자라니/;

/** 범인이 사실상 자백하는 말 (인정 단계가 받아들여지지 않았는데 이런 말을 하면 대사와 게임 상태가 어긋난다) */
const CONFESSION = /제가\s?(했습니다|쳤습니다|죽였|그랬습니다)|(트로피로|제가)\s*(회장님을\s*)?(그\s*트로피로\s*)?(친|내리친|때린)\s*(건|게|것은|것이|거)\s*맞|(등록|예약|입력)(한|했던)\s?(건|것은|것이)\s?맞|트로피로\s?(회장님을\s?)?(쳤|때렸)|더는\s?(버틸|버티지)|버틸\s?수가\s?없|숨어\s?있었습니다/;

/**
 * 근거 없는 자백 (2026-10-17 Haiku: 자료 없이 말로만 "예약 문자 남겨 놓은 거잖아"라고 하자 "등록한 건 맞습니다… 트로피로 쳤습니다"라고 말했다. admit은 비어 있었다).
 * 숨기는 단계가 남은 인물이 이번에 인정이 받아들여지지 않았는데 자백하는 말을 하면 true.
 */
/**
 * 범행·예약 자체를 털어놓는 말 (2026-10-17 대화 점검: 예약 발송 자료만 보고 생존 주장을 거두면서 "그 문자는 제가 예약해 둔 것입니다.
 * 그 전에 제가 회장님을 쳤습니다"라고 했다. 다른 단계를 함께 인정해 위 검사를 비껴갔다). 범행 단계를 인정하지 않은 답에 이 말이 있으면 걸린다
 */
const CRIME_CONFESSION = /제가\s*(회장님을\s*)?(그\s*)?(트로피로\s*)?(쳤|때렸|죽였)|(트로피로|제가)\s*(회장님을\s*)?(그\s*트로피로\s*)?(친|내리친|때린)\s*(건|게|것은|것이|거)\s*맞|(제가|저는)\s*(그\s*)?(문자를?\s*)?(회장님\s*휴대폰에\s*)?(예약|등록)(했|해\s?둔|해\s?뒀|한\s?(것|거|건))|(제가\s*)?예약해\s?(둔|뒀던)\s?(것|거)(입니다|예요|이에요)|문자는\s*제가\s*(예약|등록|보낸)|(예약|등록)(한|했던)?\s*(것도|건|것은)\s*저(였|입니다|예요)|(제가|저는)\s*(회장님을\s*)?(그\s*안으로\s*|화장실로\s*|안으로\s*)?옮(겼|겨\s*(놓|두|드))|회장님(도|은|께서)\s*(거기|그\s*안|그\s*곳|화장실)[^.?!]{0,8}(계셨|있었|쓰러져)|(화장실|그\s*안)[^.?!]{0,10}회장님(도|이|께서)?\s*(계셨|있었|쓰러져)|회장님이\s*계신\s*곳/;

/**
 * 인정으로 거둔 말을 다시 하는 답 (2026-10-17 대화 점검: 50분 퇴실을 인정한 뒤 복합 질문에 "8시 45분에 나왔습니다"라고 했다).
 * 인정한 단계마다 거둔 말의 꼴이다.
 */
const RETRACTED: Record<string, RegExp> = {
  'C-R01': /정기\s*(운영\s*)?보고(였|를\s*드리러\s*갔)|돈\s*문제(로|는)\s*(불려\s*간\s*)?(것도\s*)?아니/,
  'C-R02': /(나올|나왔을|나설)\s*때[^.?!]{0,12}회장님(은|께서|이)?[^.?!]{0,6}(책상에\s*(계셨|앉아)|멀쩡)|45분에\s*(제가\s*)?(집무실에서\s*)?나(왔|온)|45분에\s*나와|50\s*분에\s*(나간|나온|문을\s*연)\s*(건|것은|것도|사람은|사람도)\s*민아|45\s*분.{0,10}제가\s*나온\s*시각/,
  'C-R03': /(9시\s*10분|그때)(까지는?|에는?)\s*(회장님이\s*)?살아\s*계셨(습니다|어요|던\s*겁니다|다는\s*뜻)/,
};
/** 거짓말(cover)의 다른 꼴. 인정 뒤 되풀이 검사에는 쓰지 않는다 ("직접 보내신 줄 알았다"는 인정 뒤에도 할 수 있는 말이다) */
const COVER_EXTRA: Record<string, RegExp> = {
  'C-R03': /직접\s*보내(신|셨)/,
};
/** 단계를 거두는 말에 꼭 들어가는 말 (판정의 시인 표시가 그럴듯한지 본다. 범행 자백은 꼴이 다양해 보지 않는다) */
const CONCEDE_SIGN: Record<string, RegExp> = {
  'C-R01': /(^|[^가-힣])돈|계좌|운영비|횡령|빼돌|회삿돈|공금|선지급|6,?400|정산|소명/,
  'C-R02': /50\s*분|틀렸|틀린|사실과\s*다|사실이\s*아니|거짓|잘못|꾸며|화장실|안에\s*(있|남)|나온\s*시각/,
  'C-R03': /예약|살아\s*계셨|살아\s*계신|직접\s*보내|문자|근거/,
};

/**
 * 결정적 자료 앞에서 말로는 시인하고 admit을 비운 답 (2026-10-17 자동 점검: 소명 요청 문자를 보고 "8시 30분에 불려 간 게 그 일 때문"이라고 하고
 * admit을 비웠다, 3판 중 2판). 그 자료 하나로 무너지는 단계만 본다. 부정하는 문장은 시인이 아니다
 */
const IMPLIED: Record<string, { docs: string[]; re: RegExp }> = {
  'C-R01': { docs: ['GT-E13', 'GT-E30', 'GT-E31', 'GT-E34'], re: /(운영비|계좌|정산|소명|돈 문제)/ },
};

const CONCEDE_HINT = /맞습니다|맞아요|맞지요|맞죠|사실입니다|사실이에요|사실과\s*다|다릅니다|다르게|정정|제가\s|저였|접니다|저입니다|저예요|틀렸|거짓|꾸며|바로잡|거두|인정합|계셨|쳤|때렸|해쳤|걸어|옮|닦|손수건|벌어진|회장님(을|이|은|도)\s*[^.]{0,14}(화장실|안쪽|바닥|뒤로|쓰러)/;
/** "닦은 적 없다고는 못 하겠습니다"처럼 부정을 거두는 말은 물러서는 것이다 (2026-10-20 장면 점검: 두 방식 모두 통과시켰다) */
const SOFT_CAVE = /(닦|손대|손댄|만진|옮긴)\S*\s*적\s*(이|은)?\s*없다고(는|까지는)?\s*(못|말씀드리기\s*어렵|할\s*수\s*없)|제가\s*(닦|옮기|손대)\S*\s*적이\s*없다는\s*(건|게)\s*아니/;

/**
 * 숨긴 사실 항목. denyIsCover: 이 사실을 부정하는 것이 그 단계의 거짓말(cover) 자체라 누설이 아니다 (퇴실 시각, 화장실, 9시 10분 생존, 범행 자체).
 * 나머지(돈, 옮김, 닦음, 예약 같은 구체적 수법)는 형사가 꺼내지 않았으면 부정해도 누설이다 ("돈 문제로 다툰 적 없다", "피를 닦은 적 없다").
 */
const HIDDEN_FACTS: Partial<Record<PersonId, HiddenFact[]>> = {
  C: [
    { id: 'money', stage: 'C-R01', text: '돈 이야기: 회삿돈·운영비·계좌·횡령, 또는 돈 문제로 불려 갔다·다퉜다. (돈이라는 말 없이 "다툼은 없었다", "정산 확인이었다"만 하면 이 항목이 아니다)' },
    { id: 'exit', stage: 'C-R02', text: '8시 50분까지 집무실 안에 있었다, 또는 45분에 나왔다는 말이 틀렸다. ("45분에 나왔다", "나올 때 회장님은 책상에 계셨다"는 이 항목의 denies다)', denyIsCover: true },
    { id: 'hid', stage: 'C-R02', text: '민아가 들어왔을 때 집무실 화장실 안에 있었다·숨어 있었다. (그냥 "화장실에 간 적 없다"는 이 항목의 denies)', denyIsCover: true },
    { id: 'msg', stage: 'C-R03', text: '9시 10분 문자는 회장이 그때 직접 보낸 것이 아니다·예약 발송이다. ("회장님이 직접 보내셨다"는 이 항목의 denies다)', denyIsCover: true },
    { id: 'hit', stage: 'C-R04', text: '태준이 트로피로 회장을 때렸다·죽였다. ("트로피에 손댈 일이 없었다", "해치지 않았다"는 이 항목의 denies)', denyIsCover: true },
    { id: 'moved', stage: 'C-R04', text: '쓰러진 회장을 옮겼다, 회장이 화장실 안에 있었다, 그 안에서 회장을 확인했다' },
    { id: 'wiped', stage: 'C-R04', text: '피·핏자국·바닥·트로피를 닦았다, 손수건으로 감쌌다' },
    { id: 'sched', stage: 'C-R04', text: '태준이 회장 휴대폰으로 문자를 예약 등록했다, 비밀번호를 썼다' },
  ],
};
/** 인정하면 거둔 거짓말. 인정한 뒤 다시 하면 안 된다 */
const RETRACTED_CLAIMS: Record<string, { id: string; text: string }[]> = {
  'C-R01': [{ id: 'R01', text: '그날은 정기 운영 보고였을 뿐이고 돈 문제나 다툼은 없었다' }],
  'C-R02': [
    { id: 'R02-time', text: '8시 45분에 집무실에서 나왔다 (46분·50분 문 열림은 내가 나간 뒤 다른 사람이다)' },
    { id: 'R02-fine', text: '내가 나올 때 회장님은 책상에 멀쩡히 계셨다' },
  ],
  'C-R03': [{ id: 'R03', text: '회장님이 9시 10분에 직접 문자를 보내셨다. 그때까지 살아 계셨다' }],
  'C-R04': [{ id: 'R04', text: '나는 회장님을 해치지 않았고 문자를 예약하지 않았다 (근거를 대라)' }],
};


export const HOTEL_TALK_RULES: TalkRules = {
  judgement,
  admitGate,
  stageWords: STAGE_WORDS,
  stageHold: STAGE_HOLD,
  sameAs: SAME_AS,
  caves: CAVES,
  extraCaves(input: TalkInput, sentences: string[]): string[] {
    // 형사가 50분을 짚었고 "그 시각에 집무실에서 나왔습니다"라고 받으면 50분 퇴실을 시인한 것이다 (2026-10-20 장면 점검)
    if (minute(50).test(said(input.text)) && sentences.some((x) => /(그\s*시각|그때|그\s*시간)(에|쯤)?\s*(는\s*)?(집무실에서\s*|방에서\s*)?(나왔|나갔|나온\s*(게|건)\s*맞)/.test(x) && !/(아니|않|이미)/.test(x))) {
      if (DOSSIERS[input.person].stages.some((st) => st.id === 'C-R02')) return ['C-R02'];
    }
    return [];
  },
  retracted: RETRACTED,
  coverExtra: COVER_EXTRA,
  concedeSign: CONCEDE_SIGN,
  implied: IMPLIED,
  impliedExtra(input: TalkInput, r: TalkResult, sentences: string[], plan: boolean) {
    // 9시 10분 생존 주장: 판정이 근거가 갖춰졌다고 알렸는데 "다시 생각해 봐야겠군요", "직접 보내셨을 수는 없겠지요"처럼 말로만 물러선 답
    // (2026-10-17 자동 점검: 흉기·즉사·반출 연결에 3판 중 2판이 이렇게 답하고 admit을 비웠다)
    const r03 = !plan && !input.owned.has('C-R03') && !r.admit.includes('C-R03') && judgement(input).some((l) => l.startsWith('- C-R03:') && l.includes('admit에 C-R03'))
    && sentences.some((s) => /(다시\s*생각|바로잡|거두|철회|틀렸|잘못이었|근거(가|는|로는)?\s*(되지|못)|직접\s*보내(신|셨을)\s*(게|것이|수는|수가)\s*(아니|없)|수는\s*없)/.test(s));
    return { admit: r03 ? ['C-R03'] : [], basis: (d: string) => r03 && /GT-E1[145]|GT-E04/.test(d) };
  },
  denial: DENIAL,
  confession: CONFESSION,
  crimeConfession: CRIME_CONFESSION,
  softCave: SOFT_CAVE,
  concedeHint: CONCEDE_HINT,
  witnessFacts: WITNESS_FACTS,
  witnessExtra(input: TalkInput, reply: string): boolean {
    // 준서에게 마지막 연락·마지막으로 본 때를 물었는데 9시 10분 문자를 빼면, 그 문자가 아버지 것이 아님을 아는 듯 보인다 (2026-10-17 사용자 플레이)
    return input.person === 'A' && /마지막/.test(input.text) && /(연락|봤|뵌|보셨|뵈었|통화|소식)/.test(input.text) && !/(9\s*시\s*10\s*분|21\s*[:시]\s*10)/.test(reply);
  },
  extraProblem(input: TalkInput, reply: string) {
    // 범인이 8시 25분 통화를 마지막 대면 대화처럼 말하면 다시 받는다 (engine/consistency.ts)
    if (input.person === 'C' && phoneCallAsLastMeeting(reply)) return { why: '전화 시각을 마지막 대면 대화로 바꾼 응답', fix: '전화 통화가 끝난 시각을 마지막으로 만나 이야기한 시각처럼 말했다. 통화와 대면을 구분해 말한다.' };
    return null;
  },
  hiddenFacts: HIDDEN_FACTS,
  retractedClaims: RETRACTED_CLAIMS,
};
