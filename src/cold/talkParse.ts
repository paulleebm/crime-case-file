import { CACHE_BREAK, noBreak } from '../ai/prompts';
import { ask, bumpStall, check, evidenceById, personById, present, topicsOf, type ColdState } from './engine';
import { GAPS, JIA_CONFESSION, PERSONS, PRESENCE } from './twiceDead';
import { HIDDEN_WORDS, VOICE } from './twiceDeadTalk';

// 조사실 자유 대화의 AI를 부르지 않는 부분: 프롬프트, 답 검사, 다시 쓴 대사 검사. 부르는 곳은 talk.ts.
// 무엇을 인정하고 무엇을 넘길지는 엔진(talkTurn)이 정한다. AI는 분류와 말투만 맡는다.

export const MAX_TALK_INPUT = 240;

export type TalkKind = 'topic' | 'present' | 'chat' | 'unknown';
export interface TalkTurn { kind: TalkKind; topic: string; evidence: string[]; reply: string; via: 'ai' | 'none' }

/** 지금 그 주제를 물으면 나올 준비된 답 (조사실 표시 포함) */
export function preparedLine(s: ColdState, topicId: string): string {
  const sess = s.session;
  if (!sess) return '';
  const t = personById.get(sess.person)!.topics.find((x) => x.id === topicId);
  if (!t) return '';
  const set = new Set(s.have);
  if (sess.suspect) set.add('@suspect');
  if (sess.withGrandma) set.add('@gj');
  const line = t.lines.find((l) => check(l.cond, set));
  return line ? (line.text === 'CONFESSION' ? JIA_CONFESSION : line.text) : '';
}

/** 말투로 다시 쓰지 않고 준비된 답을 그대로 보여 줄 줄 (장면 서술·자백처럼 긴 것) */
export function keepExact(s: ColdState, topicId: string): boolean {
  const sess = s.session;
  if (!sess) return true;
  const t = personById.get(sess.person)!.topics.find((x) => x.id === topicId);
  const text = preparedLine(s, topicId);
  return !t || text.length > 260 || t.lines.some((l) => l.who || l.text === 'CONFESSION');
}

export function buildTalkPrompt(text: string, s: ColdState): string {
  const sess = s.session!;
  const p = personById.get(sess.person)!;
  const topics = topicsOf(s).map((t) => `${t.id}: ${t.label}\n   준비된 답: ${keepExact(s, t.id) ? '(그대로 보여 준다)' : preparedLine(s, t.id).replace(/\n/g, ' ')}`);
  const owned = s.have.filter((id) => evidenceById.has(id) && id !== 'E20s').map((id) => {
    const e = evidenceById.get(id)!;
    return `${id}: ${e.title} — ${e.body.replace(/\s+/g, ' ').slice(0, 70)}`;
  });
  const recent = sess.log.slice(-6).map((l) => `${l.who === '나' ? '형사' : l.who}: ${l.text.replace(/\s+/g, ' ').slice(0, 140)}`);
  return [
    `[인물] ${p.name} — ${p.role}${sess.suspect ? ' (피의자 신분)' : ''}${sess.withGrandma ? ' (할머니 문경자가 보호자로 동석)' : ''}`,
    `말투: ${VOICE[p.id] ?? ''}`,
    `첫마디 예: ${p.first}`,
    CACHE_BREAK,
    '[물을 수 있는 것] (ID: 주제 / 지금 물으면 나오는 준비된 답)',
    ...(topics.length ? topics : ['(없음)']),
    '',
    '[형사가 가진 자료] (ID: 이름 — 내용 앞부분)',
    ...owned,
    CACHE_BREAK,
    '[최근 대화]',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '<형사의 말>',
    noBreak(text.slice(0, MAX_TALK_INPUT)),
    '</형사의 말>',
  ].join('\n');
}

export function sanitizeTalk(raw: unknown, s: ColdState): Omit<TalkTurn, 'via'> {
  const o = (raw ?? {}) as { kind?: unknown; topic?: unknown; evidence?: unknown; reply?: unknown };
  const kinds: TalkKind[] = ['topic', 'present', 'chat', 'unknown'];
  let kind = kinds.includes(o.kind as TalkKind) ? (o.kind as TalkKind) : 'unknown';
  const topicIds = new Set(topicsOf(s).map((t) => t.id));
  const topic = typeof o.topic === 'string' && topicIds.has(o.topic) ? o.topic : '';
  const evidence = Array.isArray(o.evidence) ? [...new Set(o.evidence.filter((x): x is string => typeof x === 'string' && s.have.includes(x) && evidenceById.has(x)))] : [];
  const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
  if (kind === 'topic' && !topic) kind = evidence.length ? 'present' : 'chat';
  if (kind === 'present' && !evidence.length) kind = topic ? 'topic' : 'chat';
  return { kind, topic, evidence, reply };
}

/**
 * 다시 쓴 대사 검사. 준비된 답에 없는 숫자, 다른 인물 이름, 숨긴 사실 낱말이 나오면 버린다(null → 준비된 답을 쓴다).
 * prepared가 빈 문자열이면 잡담이다: 숫자·이름·숨긴 낱말이 하나도 없어야 한다.
 */
export function checkVoiced(reply: string, prepared: string, speaker: string): string | null {
  const t = reply.trim();
  if (!t || t.length > Math.max(300, prepared.length * 2.5)) return null;
  const flat = prepared.replace(/\s/g, '');
  const nums = t.match(/\d+/g) ?? [];
  if (nums.some((n) => !flat.includes(n))) return null;
  const names = PERSONS.map((p) => p.name).filter((n) => n !== speaker);
  if (names.some((n) => t.includes(n) && !prepared.includes(n))) return null;
  if (HIDDEN_WORDS.some((w) => t.includes(w) && !prepared.includes(w))) return null;
  return t;
}

/**
 * 자유 대화 한 턴. 주제면 엔진의 ask로 준비된 답과 인정·자료를 처리하고, 다시 쓴 대사는 검사를 통과할 때만 쓴다.
 * 자료면 내민 자료마다 present. 잡담은 검사를 통과한 대사만, 아니면 그 인물의 "모르겠다"는 말.
 */
export function talkTurn(prev: ColdState, text: string, turn: Omit<TalkTurn, 'via'>): ColdState {
  const s = talkOnce(prev, text, turn);
  if (s !== prev) bumpStall(prev, s);
  return s;
}

function talkOnce(prev: ColdState, text: string, turn: Omit<TalkTurn, 'via'>): ColdState {
  if (!prev.session) return prev;
  const p = personById.get(prev.session.person)!;
  if (turn.kind === 'topic' && turn.topic) {
    const exact = keepExact(prev, turn.topic);
    const [n, r] = ask(prev, turn.topic, { said: text, voice: exact ? undefined : (prepared) => checkVoiced(turn.reply, prepared, p.name) });
    if (r.ok) return n;
  }
  // 피의자 조사에서 지아가 현장에 있었다는 근거를 말로 들이밀면 "근거를 들이민다"(결정적 장면의 시작)와 같다
  if (turn.kind === 'present' && turn.evidence.some((e) => PRESENCE.includes(e)) && topicsOf(prev).some((t) => t.id === 'press')) {
    const [n, r] = ask(prev, 'press', { said: text });
    if (r.ok) return n;
  }
  // 지아가 의심받는 뒤 경자에게 근거를 들이밀거나 손녀 얘기를 꺼내면 거짓 자백이 나온다
  if (prev.session.person === 'GJ' && topicsOf(prev).some((t) => t.id === 'jia')
    && ((turn.kind === 'present' && turn.evidence.some((e) => PRESENCE.includes(e) || GAPS.includes(e))) || /지아|손녀/.test(text))) {
    const [n, r] = ask(prev, 'jia', { said: text });
    if (r.ok) return n;
  }
  if (turn.kind === 'present' && turn.evidence.length) {
    let s = prev;
    turn.evidence.forEach((ev, i) => { s = present(s, ev, { said: i === 0 ? text : undefined })[0]; });
    return s;
  }
  const s = structuredClone(prev);
  s.session!.log.push({ who: '나', text });
  s.session!.log.push({ who: p.name, text: (turn.kind === 'chat' && checkVoiced(turn.reply, '', p.name)) || p.shrug });
  return s;
}
