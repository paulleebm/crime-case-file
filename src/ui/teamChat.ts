import { checkDeskReply, DESK_RETRY, deskTalk, heardLines, MAX_DESK_INPUT, type DeskResult } from '../ai/desk';
import { fallbackSummary, interpretTeam, ownedSheet, safeTeamReply } from '../ai/team';
import { looksLikeInjection } from '../ai/interpret';
import { APP_CHECK_HELP, isAppCheckBlocked } from '../ai/transport';
import { TEAM_LINES, deflectionById, investigationById } from '../data/investigations';
import { planRequest, type TeamInterpretation } from '../engine/investigation';
import { newKey, type ChatMsg, type GameCtx, type GameState } from '../engine/state';
import { chunkGap, sleep, splitReply } from './chunks';

// 수사팀 대화의 처리 흐름. 심문 대화(conversation.ts)처럼 화면과 떨어져 있어서, 답을 기다리는 동안 다른 화면으로 옮겨도 이어진다.
// 요청을 받으면 수사팀이 바로 "알겠다, 몇 분 걸린다"고 답하고 조사를 시작한다. 결과는 시간이 지나야 들어온다 (state.tsx의 시계).
// 해석을 받지 못하면 그 말에 "응답을 받지 못함"을 남긴다. 다시 보내도 조사가 두 번 시작되지 않는다 (한 번에 하나).

let inflight: string | null = null;
export const teamBusy = () => inflight !== null;

const push = (ctx: GameCtx, msg: Omit<ChatMsg, 'id'>) => ctx.dispatch({ type: 'teamChat', msg: { ...msg, id: newKey('t') } });

/** 진행 상황을 물었을 때 조사별로 하는 말 (남은 시간은 진행 막대로 보이므로 말하지 않는다) */
const PROGRESS: Record<string, string> = {
  'GT-R11': '회장님 휴대폰 원본에서 예약 등록 기록을 추리고 있습니다.',
  'GT-R13': '관계자 표본을 모아 대조하고 있습니다.',
  'GT-R16': '감식반이 현장에서 작업 중입니다.',
  'GT-R07': '물건을 회수해 감정에 넘겼습니다.',
  'GT-R01': '부검의 소견을 기다리고 있습니다.',
  'GT-R06': '매입점에서 계약서와 보관 장부를 받아 오는 중입니다.',
  'GT-R09': '회사 정산 자료가 많아 대조하고 있습니다.',
  'GT-R10': '통신사 회신을 기다리고 있습니다.',
  'GT-R12': '흔적을 채취해 검사하고 있습니다.',
  'GT-R14': '관계자 진술과 카드 기록을 맞춰 보고 있습니다.',
};

/** 막을 요청에 대한 정해 둔 말 (그 세계 안의 사실로 짧게) */
const deflectLines = (it: TeamInterpretation) => (it.deflect ?? []).map((id) => deflectionById.get(id)?.line).filter(Boolean).join('\n');

/** 해석을 받아 수사팀의 답과 조사를 정한다 (이 순간의 최신 상태로) */
export function applyTeam(ctx: GameCtx, it: TeamInterpretation) {
  const s = ctx.getState();
  const owned = new Set(s.owned);
  switch (it.kind) {
    case 'request': {
      const plan = planRequest(it.ids, owned, s.team.jobs);
      if (plan.status === 'none') { push(ctx, { role: 'them', text: TEAM_LINES.unclear }); return; }
      if (plan.status !== 'started') { push(ctx, { role: 'them', text: plan.text, kind: plan.status, ...(plan.owned.length ? { docs: plan.owned } : {}) }); return; }
      ctx.dispatch({ type: 'teamStart', jobs: plan.jobs });
      const notes = deflectLines(it);
      push(ctx, { role: 'them', text: notes ? `${plan.text}\n${notes}` : plan.text, kind: 'ack', ...(plan.owned.length ? { docs: plan.owned } : {}) });
      return;
    }
    case 'summary': {
      const safe = it.reply ? safeTeamReply(it.reply, ownedSheet(owned)) : null;
      push(ctx, { role: 'them', text: safe ?? fallbackSummary(owned), kind: 'summary' });
      return;
    }
    case 'culprit': push(ctx, { role: 'them', text: TEAM_LINES.culprit }); return;
    case 'deflect': {
      // 진행 상황을 물으면 진행 중인 조사마다 지금 어디까지 왔는지 말한다 (얼마나 남았는지는 막대로 보인다)
      const progress = (it.deflect ?? []).includes('D-hurry') && s.team.jobs.length
        ? s.team.jobs.map((j) => `${j.label}: ${PROGRESS[j.inv] ?? '진행하고 있습니다.'}`).join('\n')
        : '';
      push(ctx, { role: 'them', text: [progress, deflectLines(it)].filter(Boolean).join('\n') || TEAM_LINES.unsupported, kind: 'deflect' });
      return;
    }
    case 'unsupported': case 'clarify':
      // 알아듣지 못한 요청에 "그런 자료는 없다"고 사실처럼 답하지 않는다 (플레이어가 그 갈래를 접지 않게)
      push(ctx, { role: 'them', text: it.kind === 'clarify' && it.reply ? safeTeamReply(it.reply, ownedSheet(owned)) ?? TEAM_LINES.unclear : TEAM_LINES.unsupported, kind: it.kind });
      return;
    default: {
      const safe = it.reply ? safeTeamReply(it.reply, ownedSheet(owned)) : null;
      push(ctx, { role: 'them', text: safe ?? TEAM_LINES.unclear, kind: it.kind });
    }
  }
}

/** 수사팀의 말을 사람처럼 나눠 보낸다. 자료 링크·종류는 마지막 말풍선에 붙인다 */
async function pushChunks(ctx: GameCtx, text: string, extra: Partial<ChatMsg> = {}) {
  const parts = splitReply(text);
  for (const [i, t] of parts.entries()) {
    if (i) await sleep(chunkGap());
    push(ctx, { role: 'them', text: t, ...(i === parts.length - 1 ? extra : {}) });
  }
}

/** 수사팀의 말 검사 (desk.ts의 checkDeskReply) */
function checkDesk(s: GameState, r: DeskResult, said: string, heard: string[]): string | null {
  const recent = s.team.chat.slice(-14).map((m) => m.text).join(' ');
  return checkDeskReply(r.reply, { owned: new Set(s.owned), said, recent, heard, deflect: r.deflect });
}

/** AI 수사팀의 답을 반영한다: 맡은 조사를 시작하고, 수사팀의 말을 보낸다 (검사를 통과하지 못하면 정해 둔 말로) */
async function applyDesk(ctx: GameCtx, r: DeskResult, said: string, heard: string[]) {
  const s = ctx.getState();
  const owned = new Set(s.owned);
  const plan = r.start.length ? planRequest(r.start, owned, s.team.jobs) : null;
  if (plan?.status === 'started') ctx.dispatch({ type: 'teamStart', jobs: plan.jobs });
  const notes = (r.deflect).map((id) => deflectionById.get(id)?.line).filter(Boolean).join('\n');
  let text = plan && plan.status !== 'none'
    ? [plan.text, notes].filter(Boolean).join('\n')
    : checkDesk(s, r, said, heard) ?? notes;
  // 다시 써도 검사를 통과하지 못한 답: 새 조사 대상을 묻는 말로 바꾸지 않는다 (질문은 자료 해석이었을 수 있다)
  if (!text) text = TEAM_LINES.rephrase;
  // 실물·원본을 먼저 확보해야 해서 함께 맡은 조사는 알려 준다
  const auto = plan?.status === 'started' ? plan.jobs.filter((j) => !r.start.includes(j.inv)).map((j) => j.label).filter((l) => !text.includes(l)) : [];
  if (auto.length) text += `\n대상 물건과 원본을 먼저 확보해야 해서 ${auto.join(', ')}도 함께 맡았습니다.`;
  // 본인에게 받아야 하는 자료는 안내가 빠지지 않게 한다
  const redirect = r.start.map((id) => investigationById.get(id)!).filter((d) => d.redirect && !(d.redirectDoc && owned.has(d.redirectDoc)));
  for (const d of redirect) if (!text.includes('준서')) text += `\n${d.redirect}`;
  const kind = plan?.status === 'started' ? 'ack' : r.deflect.length ? 'deflect' : 'talk';
  await pushChunks(ctx, text, { kind, ...(plan?.owned.length ? { docs: plan.owned } : {}) });
}

/** 수사관의 말을 수사팀에 보낸다. retryId가 있으면 응답을 받지 못했던 그 말을 다시 보낸다 */
export async function sendTeam(ctx: GameCtx, raw: string, retryId?: string): Promise<void> {
  const t = raw.trim().slice(0, MAX_DESK_INPUT);
  if (!t || inflight) return;
  if (!retryId && looksLikeInjection(t)) {
    push(ctx, { role: 'me', text: t });
    push(ctx, { role: 'them', text: TEAM_LINES.unclear });
    return;
  }
  let id = retryId;
  if (id) ctx.dispatch({ type: 'teamPatch', id, patch: { status: 'pending', error: undefined } });
  else {
    id = newKey('t');
    ctx.dispatch({ type: 'teamChat', msg: { id, role: 'me', text: t, status: 'pending' } });
  }
  inflight = id;
  try {
    const s = ctx.getState();
    const history = s.team.chat.filter((m) => m.id !== id);
    let desk: DeskResult | null = null;
    const heard = heardLines(s.statements, new Set(s.owned));
    const input = { text: t, owned: new Set(s.owned), history, jobs: s.team.jobs, heard };
    try {
      desk = await deskTalk(input);
    } catch (e) {
      if (import.meta.env?.DEV) console.warn('[수사팀 대화 실패, 낱말 해석으로]', e);
    }
    // 맡은 조사 없이 말만 했는데 그 말이 검사에 걸리면 한 번 다시 쓰게 한다
    if (desk && !desk.start.length && !desk.deflect.length && !checkDesk(ctx.getState(), desk, t, heard)) {
      try { desk = await deskTalk({ ...input, retry: DESK_RETRY }); } catch { /* 처음 답으로 처리한다 */ }
    }
    if (desk) {
      ctx.dispatch({ type: 'teamPatch', id, patch: { status: undefined, error: undefined } });
      await applyDesk(ctx, desk, t, heard);
      return;
    }
    let it: TeamInterpretation;
    try {
      it = await interpretTeam(t, new Set(s.owned), s.team.done, history, s.team.jobs);
    } catch (e) {
      ctx.dispatch({ type: 'teamPatch', id, patch: { status: 'failed', error: isAppCheckBlocked(e) ? APP_CHECK_HELP : '요청은 접수되지 않았다. 그대로 다시 보낼 수 있다.' } });
      return;
    }
    ctx.dispatch({ type: 'teamPatch', id, patch: { status: undefined, error: undefined } });
    applyTeam(ctx, it);
  } finally {
    inflight = null;
    const m = ctx.getState().team.chat.find((x) => x.id === id);
    if (m?.status === 'pending') ctx.dispatch({ type: 'teamPatch', id: id!, patch: { status: 'failed', error: '처리 중 문제가 생겼다.' } });
  }
}
