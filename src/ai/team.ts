import { plain } from '../data/clues';
import { DEFLECTIONS, INVESTIGATIONS, SUMMARY_ID } from '../data/investigations';
import { evidenceById } from '../engine/lookup';
import { matchRequest, type TeamInterpretation, type TeamKind } from '../engine/investigation';
import type { ChatMsg } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { callAI } from './transport';
import { josa } from '../engine/josa';

// 수사팀 대화의 AI. 플레이어의 자연어 요청을 카탈로그 ID로 옮긴다. 요약 요청에는 가진 자료만으로 답을 쓴다.
// 어떤 자료를 언제 넘길지는 엔진(src/engine/investigation.ts)이 정한다.

export const MAX_TEAM_INPUT = 200;

const KINDS: TeamKind[] = ['request', 'summary', 'clarify', 'unsupported', 'culprit', 'deflect', 'chat'];

/** 확보한 자료의 본문 (요약 답의 재료이자 검사 기준) */
export function ownedSheet(owned: Set<string>): string {
  return [...owned].filter((id) => evidenceById.has(id)).map((id) => `- ${evidenceById.get(id)!.title}: ${evidenceById.get(id)!.summary}`).join('\n');
}

export function buildTeamPrompt(text: string, owned: Set<string>, done: string[], history: ChatMsg[], jobs: { label: string }[] = []): string {
  const recent = history.filter((m) => !m.status).slice(-6).map((m) => `${m.role === 'me' ? '수사관' : '수사팀'}: ${plain(m.text).replace(/\s+/g, ' ').slice(0, 160)}`);
  return [
    '[요청 카탈로그] (ID: 조사 내용 / 이런 말로 요청한다)',
    ...INVESTIGATIONS.map((x) => `${x.id}: ${x.topic} / 예: ${x.aliases.slice(0, 5).join(', ')}`),
    `${SUMMARY_ID}: 지금까지 확보한 기록 요약 (kind summary로 답한다)`,
    '',
    '[막을 요청] (ID: 이런 요청. 이런 요청이 들어 있으면 ids에 이 ID도 넣는다)',
    ...DEFLECTIONS.map((d) => `${d.id}: ${d.topic}`),
    CACHE_BREAK,
    '[확보한 자료]',
    ownedSheet(owned) || '(없음)',
    '',
    `[끝난 조사] ${done.length ? done.join(', ') : '(없음)'}`,
    `[진행 중인 조사] ${jobs.length ? jobs.map((j) => j.label).join(', ') : '(없음)'}`,
    CACHE_BREAK,
    '[최근 대화]',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '<수사관의 말>',
    noBreak(text.slice(0, MAX_TEAM_INPUT)),
    '</수사관의 말>',
  ].join('\n');
}

export function sanitizeTeam(raw: unknown): TeamInterpretation {
  const o = (raw ?? {}) as { kind?: unknown; ids?: unknown; reply?: unknown };
  const kind = KINDS.includes(o.kind as TeamKind) ? (o.kind as TeamKind) : 'clarify';
  const known = new Set(INVESTIGATIONS.map((x) => x.id));
  const dkeys = new Set(DEFLECTIONS.map((d) => d.id));
  const given = Array.isArray(o.ids) ? o.ids.filter((x): x is string => typeof x === 'string') : [];
  const ids = [...new Set(given.filter((x) => known.has(x)))];
  const deflect = [...new Set(given.filter((x) => dkeys.has(x)))];
  const reply = typeof o.reply === 'string' ? o.reply.trim() : '';
  const extra = deflect.length ? { deflect } : {};
  // 막을 요청과 함께 할 수 있는 조사를 말했으면 할 수 있는 조사는 맡는다
  if (ids.length && kind !== 'summary') return { kind: 'request', ids, ...extra };
  if (deflect.length) return { kind: 'deflect', ids: [], deflect };
  // 요청이라면서 ID가 없으면 무엇을 할지 모르는 것이다
  if (kind === 'request') return { kind: 'clarify', ids: [], reply };
  return { kind, ids, ...(reply ? { reply } : {}) };
}

/**
 * 수사팀이 쓴 말 검사: 확보한 자료에 없는 숫자, 범인 단정, 자료를 건네는 척하는 말은 쓰지 않는다.
 * 통과하지 못하면 null (정해 둔 말로 대신한다).
 */
export function safeTeamReply(reply: string, sheet: string): string | null {
  const t = reply.trim();
  if (!t || t.length > 420 || t.includes('⟦')) return null;
  const nums = t.match(/\d[\d,:]*/g) ?? [];
  const flat = sheet.replace(/\s/g, '');
  if (nums.some((n) => !flat.includes(n.replace(/[,:]$/, '')))) return null;
  if (/(범인은\s*[가-힣]+\s*(씨|입니다|예요|이에요|이다)|[가-힣]+\s*(씨가|씨는)\s*범인|범인이\s*(맞|확실|분명)|진범|살해했|죽였습니다|죽인 사람은)/.test(t)) return null;
  if (/(\d+\s*분\s*(쯤|뒤|후|정도|걸))/.test(t)) return null;
  return t;
}

/** 요약 요청에 AI가 답하지 못했을 때: 가진 자료 이름만 정리한다 */
export function fallbackSummary(owned: Set<string>): string {
  const docs = [...owned].filter((id) => evidenceById.has(id)).map((id) => evidenceById.get(id)!.title);
  return `지금 자료함에는 ${josa(docs.join(', '), '이/가')} 있습니다.\n자료마다 근거 문장이 표시되어 있으니, 필요한 원본이나 감정을 이어서 요청해 주세요.`;
}

/** 수사팀 요청 해석. AI에 닿지 않으면 낱말로 고르고, 그래도 고를 수 없으면 예외를 던진다 (다시 보낼 수 있게) */
export async function interpretTeam(text: string, owned: Set<string>, done: string[], history: ChatMsg[], jobs: { label: string }[] = []): Promise<TeamInterpretation & { local?: boolean }> {
  try {
    const raw = await callAI('team', buildTeamPrompt(text, owned, done, history, jobs), { attemptMs: 15000, hedgeMs: 6000, budgetMs: 35000, parse: JSON.parse });
    return sanitizeTeam(JSON.parse(raw));
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[수사팀 해석 실패, 낱말로]', e);
    const local = matchRequest(text);
    if (local.kind === 'clarify' && !local.reply) throw e;
    return { ...local, local: true };
  }
}
