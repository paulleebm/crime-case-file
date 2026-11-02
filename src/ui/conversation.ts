import { looksLikeInjection } from '../ai/interpret';
import { MAX_TALK_INPUT, talk, type TalkResult } from '../ai/talk';
import { APP_CHECK_HELP, isAppCheckBlocked } from '../ai/transport';
import { CHALLENGES, CONFESSION, PERSONS } from '../data/case';
import { STATEMENT_FORMS } from '../data/statementForms';
import { linesOf } from '../data/tone';
import type { PersonId } from '../data/types';
import { visibleClaims } from '../engine/claims';
import { evidenceById, nameOf, statementById } from '../engine/lookup';
import { settledTalk, writeStatement } from '../ai/statement';
import { newKey, viewingPerson, type ChatMsg, type Draft, type GameCtx } from '../engine/state';
import { chunkGap, sleep, splitReply } from './chunks';
import { josa } from '../engine/josa';

// 심문 대화의 처리 흐름 (2026-10-15 자유 대화). 화면(대화창)과 떨어져 있어서, 답을 기다리는 동안 다른 자료나 인물로 옮겨도 이어진다.
// 인물의 말은 AI가 인물 설정 문서와 대화 흐름을 보고 자유롭게 짓는다. 정해 둔 대사를 고르지 않는다.
// AI가 함께 알려 준 변화(진술서 기록·자료 넘기기·거짓말 인정)를 여기서 게임 상태에 반영한다.
// 형사의 말은 보내는 즉시 "응답 대기"로 남고, 답이 오면 표시를 지운다. 답을 받지 못하면 "응답을 받지 못함"을 남겨 다시 보낼 수 있다.

const pick = (arr: string[]) => arr[Math.floor(Math.random() * arr.length)];

/** 사람별로 지금 처리 중인 말 (같은 사람에게 동시에 두 말을 처리하지 않는다) */
const inflight = new Map<PersonId, string>();

export const isBusy = (person: PersonId) => inflight.has(person);

/** AI에게 넘길 대화 기록: 응답 대기·실패한 말은 뺀다 (인물이 듣지 못한 말이다) */
const settledChat = (msgs: ChatMsg[], except?: string) => msgs.filter((m) => !m.status && m.id !== except);

function push(ctx: GameCtx, person: PersonId, msg: Omit<ChatMsg, 'id'>) {
  ctx.dispatch({ type: 'chat', person, msg: { ...msg, id: newKey('m') } });
}

/** 인정한 진술 → 그 진술을 끌어내는 지적 */
const challengeOf = (stmt: string) => CHALLENGES.find((c) => c.reveals.includes(stmt));

/** AI의 답을 게임 상태에 반영한다. 판정은 이 순간의 최신 상태로 한다 */
async function apply(ctx: GameCtx, person: PersonId, r: TalkResult, msgId?: string) {
  const p = PERSONS[person];
  const owned = new Set(ctx.getState().owned);
  const base = STATEMENT_FORMS[person].statementId;
  const reveals: string[] = [...r.record, ...r.give, ...r.admit];
  // 진술서는 첫 진술이 들어가거나 정정될 때 생긴다
  if ((r.record.length || r.admit.length) && !owned.has(base)) reveals.push(base);
  const fresh = [...new Set(reveals)].filter((id) => !owned.has(id));

  if (msgId) ctx.dispatch({ type: 'chatPatch', person, id: msgId, patch: { status: undefined, error: undefined } });
  const record = r.admit[r.admit.length - 1];
  // 무너뜨린 거짓말을 플레이어가 한 번도 듣지 못했다면 정정이 아니라, 근거를 보고 처음 털어놓은 진술이다
  const heardBefore = new Set(visibleClaims(person, owned).map((c) => c.id));
  // 지적(CHALLENGES)이 없는 정정은 그 정정이 지우는 문장을 들었는지로 본다
  const firstTold = (id: string) => {
    const c = challengeOf(id);
    const lies = c ? c.lies : statementById.get(id)?.strikes ?? [];
    return (!!c || statementById.has(id)) && !lies.some((l) => heardBefore.has(l));
  };
  const volunteer = !!record && firstTold(record);
  const kind: ChatMsg['kind'] = r.admit.length ? 'success' : r.record.length ? 'fact' : 'written';
  // 긴 답은 사람처럼 여러 번에 나눠 보낸다. 진술 기록·종류는 첫 말풍선에 붙인다
  const chunks = splitReply(r.reply);
  for (const [i, t] of chunks.entries()) {
    if (i) await sleep(chunkGap());
    push(ctx, person, i === 0
      ? { role: 'them', text: t, parts: [{ text: t, ...(record ? { source: record } : {}) }], ...(record ? { record } : {}), ...(volunteer ? { volunteer: true } : {}), kind, facts: r.record }
      : { role: 'them', text: t, kind: 'cont' });
    // 답을 기다리는 동안 다른 화면으로 옮겼으면 수사팀 결과처럼 알림을 띄운다 (첫 말풍선이 올 때 한 번)
    if (i === 0 && !viewingPerson(ctx.getState(), person)) ctx.dispatch({ type: 'replyArrived', person, text: r.reply });
  }

  // 거짓말이 무너졌으면 그 지적은 끝난 것이다. 최종 자백은 남은 곁가지 거짓말도 끝낸다
  for (const id of r.admit) {
    const c = challengeOf(id);
    if (!c) continue;
    for (const x of [c.id, ...(c.closes ?? [])]) if (!ctx.getState().done.includes(x)) ctx.dispatch({ type: 'done', id: x });
  }
  for (const id of r.admit) if (firstTold(id)) ctx.dispatch({ type: 'volunteer', id });
  if (!fresh.length) return;
  const newDocs = fresh.filter((id) => evidenceById.has(id));
  const newAdmit = r.admit.filter((id) => fresh.includes(id));
  const toast = newAdmit.length ? (newAdmit.every(firstTold) ? `${josa(p.name, '이/가')} 새로 털어놓았다` : `${p.name}의 진술서가 정정되었다`) : newDocs.length ? `새 자료: ${newDocs.map(nameOf).join(', ')}` : undefined;
  ctx.dispatch({ type: 'reveal', ids: fresh, toast });
  // 대화에서 건네받은 자료도 새 자료로 표시한다 (2026-10-17 사용자: 용의자가 준 자료에도 새 자료 마크가 붙어야 한다)
  for (const id of newAdmit) {
    if (r.basis.length) ctx.dispatch({ type: 'basis', id, ids: r.basis });
    push(ctx, person, firstTold(id)
      ? { role: 'note', text: '새 진술', sub: '근거를 보고 털어놓은 내용이 진술서에 더해졌다.' }
      : { role: 'note', text: '진술서 정정', sub: '앞서 한 말이 진술서에서 지금의 진술로 바뀌었다.' });
    if (id === CONFESSION) push(ctx, person, { role: 'note', text: `${josa(p.name, '이/가')} 범행을 자백했다`, sub: '사건 재구성에서 결론을 정리해 제출하자.' });
  }
  // 새 자료는 어떻게 손에 넣었는지 한 줄 남긴다
  for (const id of newDocs) {
    const ev = evidenceById.get(id)!;
    push(ctx, person, { role: 'note', text: `새 자료 · ${ev.title}`, sub: ev.obtained });
  }
}

/**
 * 형사의 말을 보낸다. retryId가 있으면 응답을 받지 못했던 그 말을 다시 보낸다 (새 말을 만들지 않는다).
 * draft: 함께 내민 자료(evidence)와 짚은 말(pin). 자료 내용 전체가 AI에 들어간다.
 */
export async function send(ctx: GameCtx, person: PersonId, raw: string, retryId?: string, draft?: Draft): Promise<void> {
  const shown = !!draft?.pin || !!draft?.evidence.length;
  // 말을 비우고 자료만 내밀었으면, 자료를 내미는 말로 보낸다
  const t = (raw.trim() || (shown ? '이걸 보시죠. 어떻게 생각하세요?' : '')).slice(0, MAX_TALK_INPUT);
  if (!t || inflight.has(person)) return;
  const att = shown ? { ...(draft!.pin ? { pin: draft!.pin } : {}), ...(draft!.evidence.length ? { attached: draft!.evidence } : {}) } : {};
  // 해석기를 조작하려는 말은 AI에 보내지 않는다. 인물은 무슨 말인지 모르겠다고 답한다
  if (!retryId && looksLikeInjection(t)) {
    push(ctx, person, { role: 'me', text: t, ...att });
    push(ctx, person, { role: 'them', text: pick(linesOf(person, new Set(ctx.getState().owned)).clarify), kind: 'clarify' });
    return;
  }
  let id = retryId;
  if (id) ctx.dispatch({ type: 'chatPatch', person, id, patch: { status: 'pending', error: undefined } });
  else {
    id = newKey('m');
    ctx.dispatch({ type: 'chat', person, msg: { id, role: 'me', text: t, status: 'pending', ...att } });
  }
  inflight.set(person, id);
  try {
    const s = ctx.getState();
    const owned = new Set(s.owned);
    let r: TalkResult;
    try {
      r = await talk({ person, text: t, owned, history: settledChat(s.chats[person], id), attached: draft?.evidence, pin: draft?.pin });
    } catch (e) {
      if (import.meta.env?.DEV) console.warn('[대화 실패]', e);
      ctx.dispatch({ type: 'chatPatch', person, id, patch: { status: 'failed', error: isAppCheckBlocked(e) ? APP_CHECK_HELP : '응답을 받지 못했다. 그대로 다시 보낼 수 있다.' } });
      return;
    }
    if (import.meta.env?.DEV) console.info('[대화]', JSON.stringify(r));
    await apply(ctx, person, r, id);
    // 답이 끝나면 진술서를 대화에 맞춰 다시 정리한다 (기다리지 않는다)
    void refreshStatement(ctx, person);
  } finally {
    inflight.delete(person);
    // 처리 중 예외로 표시가 남았으면 실패로 바꿔 다시 보낼 수 있게 한다
    const m = ctx.getState().chats[person].find((x) => x.id === id);
    if (m?.status === 'pending') ctx.dispatch({ type: 'chatPatch', person, id: id!, patch: { status: 'failed', error: '처리 중 문제가 생겼다.' } });
  }
}

// ─────────────── 진술서 정리 ───────────────
// 대화가 늘 때마다 AI가 진술서를 다시 정리한다. 같은 사람에게 정리가 진행 중이면 끝난 뒤 한 번 더 한다.

const writing = new Map<PersonId, boolean>();
const dirty = new Set<PersonId>();
const listeners = new Set<() => void>();
/** 진술서를 정리하는 중인 사람 (화면에 "정리 중"을 보여 준다) */
export const statementBusy = (person: PersonId) => !!writing.get(person);
export function onStatementBusy(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }
const notify = () => listeners.forEach((f) => f());

export async function refreshStatement(ctx: GameCtx, person: PersonId): Promise<void> {
  if (writing.get(person)) { dirty.add(person); return; }
  const s = ctx.getState();
  const talked = settledTalk(s.chats[person]);
  // 인물이 아직 아무 답도 하지 않았거나, 지난번 정리 뒤로 대화가 늘지 않았으면 하지 않는다
  if (!talked.some((m) => m.role === 'them')) return;
  const prev = s.statements?.[person];
  if (prev && prev.upto >= talked.length) return;
  writing.set(person, true); notify();
  try {
    const st = await writeStatement({ person, owned: new Set(s.owned), chat: s.chats[person], prev });
    if (st.sections.length || !prev) ctx.dispatch({ type: 'statement', person, statement: st });
  } catch (e) {
    // 정리하지 못하면 이전 진술서(또는 정해 둔 문장으로 만든 진술서)를 그대로 둔다. 다음 대화 뒤에 다시 한다
    if (import.meta.env?.DEV) console.warn('[진술서 정리 실패]', e);
  } finally {
    writing.set(person, false); notify();
    if (dirty.delete(person)) void refreshStatement(ctx, person);
  }
}
