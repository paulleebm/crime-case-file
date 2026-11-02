import { PERSONS } from '../data/case';
import { BIBLE } from '../data/bible';
import { plain } from '../data/clues';
import { toneOf } from '../data/tone';
import type { PersonId } from '../data/types';
import { condMet } from '../engine/lookup';
import { CACHE_BREAK, noBreak } from './prompts';
import type { ChatMsg } from '../engine/state';

// 인물의 목소리. 엔진이 "이번에 무엇을 말할지(내용 요점)"를 정하면, AI가 설정집·지금 입장·말투·대화 흐름을 보고 그 사람의 말로 짓는다.
// 지은 말은 코드로 검사한다: 숫자와 핵심 낱말이 그대로인지, 아직 인정하지 않은 일이 새지 않았는지, 없던 사람이 끼지 않았는지.
// 검사를 통과하지 못하면 정해 둔 말을 그대로 쓴다. 진술서와 지적 판정은 정해 둔 말로 하므로 사건 논리는 바뀌지 않는다.
// 이 파일은 데이터만 쓴다 (브라우저·노드 양쪽에서 프롬프트를 만들고 검사할 수 있다).

/** 지금 켜져 있는 설정집 블록 */
function activeBlocks(person: PersonId, owned: Set<string>) {
  return BIBLE[person].blocks.filter((b) => condMet(b.cond, owned) && !(b.until && condMet(b.until, owned)));
}

/** AI에게 보여 줄 이 인물의 설정과 지금 입장 */
export function bibleSheet(person: PersonId, owned: Set<string>): string {
  return [BIBLE[person].core, '', ...activeBlocks(person, owned).map((b) => b.text)].join('\n\n');
}

/** 지금 단계에서 인물의 말에 나오면 안 되는 표현 */
export function neverTerms(person: PersonId, owned: Set<string>): string[] {
  return [...new Set(activeBlocks(person, owned).flatMap((b) => b.never ?? []))];
}

/** 이 사건의 핵심 낱말. 할 말에 들어 있으면 지은 말에도 그대로 있어야 한다 */
const GLOSSARY = [
  '집무실', '화장실', '진열대', '트로피', '받침', '책상', '휴대폰', '카드', '매입점', '온정귀금속', '로비', '회의실', '회의 준비',
  '문자', '예약', '비밀번호', '보증금', '계좌', '운영비', '정산', '횡령', '공유 작업실', '심부름', '입금', '신고', '지문',
];

const ALIASES: Record<PersonId, string[]> = {
  A: ['류준서', '준서', '아드님'],
  B: ['서민아', '민아'],
  C: ['문태준', '태준', '총지배인'],
};

export type VoiceSituation = 'answer' | 'admit' | 'resist' | 'unknown' | 'clarify';

const SITUATION: Record<VoiceSituation, string> = {
  answer: '형사의 질문에 답한다. [할 말]이 이번 답의 내용 전부다.',
  admit: '형사가 근거를 들어 숨기던 것을 깨뜨렸다. 더는 버티지 못하고 [할 말]을 털어놓는다. 새로 인정하는 것, 숨긴 이유, 아직 버티는 주장을 모두 담는다.',
  resist: '형사가 추궁했지만 이 인물은 진술을 바꾸지 않는다. [할 말]의 반박이나 태도를 유지한다. 아무것도 새로 인정하지 않는다.',
  unknown: '이 인물은 형사가 물은 것을 모르거나 기억하지 못한다. [할 말]처럼 모른다고 답하되, 형사가 물은 것을 짧게 되받아 자연스럽게 말한다. 새 사실, 추측, 다른 사람에 관한 말, 시각·숫자는 덧붙이지 않는다.',
  clarify: '형사의 말이 무엇을 묻는지, 이 인물의 어느 말을 짚는지 알아듣지 못했다. [할 말]처럼 다시 말해 달라고 한다. 새 사실은 말하지 않는다.',
};

export interface VoiceInput {
  person: PersonId;
  question: string;
  /** 이번에 할 말 (정해 둔 말. 여러 개면 한 번에 하는 말로 잇는다) */
  points: string[];
  situation: VoiceSituation;
  owned: Set<string>;
  history: ChatMsg[];
  memo?: string;
}

export function buildVoicePrompt({ person, question, points, situation, owned, history, memo }: VoiceInput): string {
  const p = PERSONS[person];
  const tone = toneOf(person, owned);
  const recent = history.slice(-6).map((m) => `${m.role === 'me' ? '형사' : m.role === 'them' ? p.name : '기록'}: ${plain(m.text)}`);
  return [
    '[인물 설정과 지금 입장] (이 인물이 지금 아는 것과 말하는 방식. 여기 없는 사실은 만들지 않는다)',
    bibleSheet(person, owned),
    // 설정집은 인물과 수사 단계가 같으면 그대로다 (캐시한다)
    CACHE_BREAK,
    `[지금 태도] ${tone.demeanor} — ${tone.voice}`,
    '',
    '[상황 메모]',
    memo || '(없음)',
    '',
    '[최근 대화]',
    ...(recent.length ? recent : ['(없음)']),
    '',
    `[이번 상황] ${SITUATION[situation]}`,
    '[할 말] (내용 메모. 순서는 형사의 말에 맞게 다시 정한다)',
    ...points.flatMap((x) => sentences(plain(x))).map((x) => `- ${x}`),
    '',
    '<형사의 말>',
    noBreak(question.slice(0, 200)),
    '</형사의 말>',
  ].join('\n');
}

/** 문장 단위로 나눈다 (따옴표 안의 문장은 나누지 않는다) */
export function sentences(text: string): string[] {
  const out: string[] = [];
  let cur = '', quote = false;
  for (const ch of text) {
    cur += ch;
    if (ch === '“') quote = true;
    else if (ch === '”') quote = false;
    else if (ch === '"') quote = !quote;
    else if (!quote && /[.?!…]/.test(ch)) { out.push(cur); cur = ''; }
  }
  out.push(cur);
  // 말줄임표·문장부호가 이어진 조각은 앞 문장에 붙인다
  const merged: string[] = [];
  for (const x of out) {
    if (/^[.?!…]+$/.test(x.trim()) && merged.length) merged[merged.length - 1] += x;
    else if (x.trim()) merged.push(x);
  }
  return merged.map((x) => x.trim());
}

const digits = (t: string) => (t.match(/\d+/g) ?? []).sort().join(',');

/** 부정·부인 표현 ("받았다"를 "손도 대지 않았다"로 뒤집는 것을 막는다) */
const NEGATION = /(않|없|아니|모르|모릅|말라|말고|말아|(?:^|[\s,])안\s?(?!에|쪽|내|녕|심|전|팎)[가-힣]|(?:^|[\s,])못\s?[가-힣])/g;
const negations = (t: string) => (t.match(NEGATION) ?? []).length;

/**
 * 지은 말 검사. 통과하면 다듬은 말, 아니면 null (정해 둔 말을 쓴다).
 * - 숫자는 하나도 바뀌거나 빠지거나 보태지지 않는다.
 * - 할 말에 있던 핵심 낱말은 그대로 있다.
 * - 지금 단계에서 나오면 안 되는 표현이 없다 (할 말 자체에 든 표현은 예외).
 * - 할 말에 없던 사람 이름이 생기지 않는다. 지나치게 길어지지 않는다.
 */
export function checkVoiced(reply: string, points: string[], person: PersonId, owned: Set<string>, question = ''): string | null {
  const source = points.map(plain).join(' ');
  const t = reply.trim().replace(/[ \t]+/g, ' ');
  if (t.length < 2 || t.includes('⟦') || t.length > source.length * 1.5 + 60) return null;
  // 숫자: 할 말의 숫자는 모두 있어야 하고, 새 숫자는 형사가 방금 말한 것만 되받을 수 있다
  const need = digits(source).split(',').filter(Boolean), got = digits(t).split(',').filter(Boolean), asked = new Set(question.match(/\d+/g) ?? []);
  const pool = [...got];
  for (const n of need) { const i = pool.indexOf(n); if (i < 0) return null; pool.splice(i, 1); }
  if (pool.some((n) => !asked.has(n))) return null;
  if (GLOSSARY.some((w) => source.includes(w) && !t.includes(w))) return null;
  // 인정·부인이 뒤집히면 안 된다: 할 말에 없던 부정을 보태거나, 부정을 모두 지우지 않는다
  const negSrc = negations(source), negOut = negations(t);
  if (negOut > negSrc || (negSrc > 0 && negOut === 0)) return null;
  if (neverTerms(person, owned).some((w) => t.includes(w) && !source.includes(w))) return null;
  // 할 말에 나온 적 없는 사람이 새로 끼면 안 된다 (같은 사람을 다른 호칭으로 부르는 것은 괜찮다)
  const named = (txt: string, x: PersonId) => ALIASES[x].some((n) => txt.includes(n));
  if ((Object.keys(ALIASES) as PersonId[]).some((x) => x !== person && named(t, x) && !named(source, x))) return null;
  // 말끝: 정해 둔 말이 "~요"로만 말하면 지은 말도 "~니다"로 끝맺지 않는다 (인물의 말투가 흔들리지 않게)
  if (!/니다[.?!…]?(\s|$)/.test(source) && /니다[.?!…]?(\s|$)/.test(t)) return null;
  if (/(보세요|보여 드|드릴게|드리겠|가져가세요|넘겨 드)/.test(t) && !/(보세요|보여 드|드릴게|드리겠|가져가|넘겨 드)/.test(source)) return null;
  return t;
}
