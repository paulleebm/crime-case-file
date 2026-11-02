import { plain } from '../data/clues';
import { DEFLECTIONS, INVESTIGATIONS, investigationById } from '../data/investigations';
import { PERSONS, STATEMENTS } from '../data/case';
import type { PersonId } from '../data/types';
import { evidenceById } from '../engine/lookup';
import { forbiddenWords } from '../engine/hints';
import { MAX_TEAM_JOBS, requestStatus, type TeamJob } from '../engine/investigation';
import type { AiStatement, ChatMsg } from '../engine/state';
import { CACHE_BREAK, noBreak } from './prompts';
import { ownedSheet } from './team';
import { callAI } from './transport';

// 수사팀 자유 대화 (2026-10-15). 카탈로그 전체·확보한 자료·진행 상황·대화 기록을 AI에 주고, 수사팀이 자연스럽게 말하게 한다.
// AI는 말과 함께 새로 맡을 조사(start)와 막을 요청(deflect)을 알려 준다. 어떤 자료를 언제 넘길지는 엔진(investigation.ts)이 정한다.

export const MAX_DESK_INPUT = 300;

export interface DeskInput {
  text: string;
  owned: Set<string>;
  history: ChatMsg[];
  jobs: TeamJob[];
  /** 수사관이 면담에서 들은 말 (heardLines) */
  heard?: string[];
  /** 앞선 답이 검사에 걸려 다시 쓰게 할 때의 안내 */
  retry?: string;
}

/**
 * 수사관이 면담에서 들은 말 (2026-10-17 플레이 리뷰: 수사팀이 진술을 몰라 "아직 공유되지 않았다, 다시 물어보라"고 했다).
 * AI 진술서가 있으면 그 문장을, 없으면 게임에 기록된 인정만 넘긴다. 객관 기록이 아니라 진술이다.
 */
export function heardLines(statements: Partial<Record<PersonId, AiStatement>> | undefined, owned: Set<string>): string[] {
  const out: string[] = [];
  for (const id of Object.keys(PERSONS) as PersonId[]) {
    const name = PERSONS[id].name;
    const st = statements?.[id];
    const lines = (st?.sections ?? []).flatMap((s) => s.lines.map((l) => (l.kind === 'revised' && l.was ? `${l.text} (앞서는 "${l.was}"라고 했다가 정정)` : l.kind === 'added' || l.kind === 'fact' ? `${l.text} (인정)` : l.text)));
    const admitted = STATEMENTS.filter((s) => s.person === id && !s.initial && owned.has(s.id)).map((s) => `${plain(s.say ?? s.text).replace(/^…\s*/, '')} (인정)`);
    const said = lines.length ? lines : admitted;
    if (said.length) out.push(`${name}:`, ...said.map((l) => `- ${plain(l)}`));
  }
  return out;
}

export interface DeskResult { reply: string; start: string[]; deflect: string[] }

/** 조사 하나의 지금 상태 */
function status(id: string, owned: Set<string>, jobs: TeamJob[]): string {
  const d = investigationById.get(id)!;
  if (d.redirect) return d.redirectDoc && owned.has(d.redirectDoc) ? '이미 받음' : `본인에게 받아야 함 — 안내: ${d.redirect.replace(/\n/g, ' ')}`;
  const current = requestStatus(id, owned, jobs);
  if (current === 'already_owned') return '이미 받음';
  const job = jobs.find((j) => j.inv === id) ?? jobs.find((j) => d.outputs.some((output) => j.outputs.includes(output)));
  if (current === 'running' && job?.inv !== id) return `진행 중 — ${job?.label ?? '접수된 조사'}에 포함되어 있다. 별도로 새로 맡지 않는다.`;
  if (job) return '진행 중';
  if (d.outputs.length && d.outputs.every((o) => owned.has(o))) return '이미 받음';
  return '맡을 수 있음';
}

export function buildDeskPrompt({ text, owned, history, jobs, heard, retry }: DeskInput): string {
  const catalog = INVESTIGATIONS.map((x) => [
    `▶ ${x.id} 「${x.label}」${x.extra ? ' (참고 자료)' : ''}`,
    `  다루는 것: ${x.topic}`,
    `  이런 말로 요청한다: ${x.aliases.join(', ')}`,
    ...(x.related?.length ? [`  함께 권할 조사: ${x.related.map((r) => `${r} 「${investigationById.get(r)?.label}」`).join(', ')}`] : []),
  ].join('\n'));
  const docs = [...owned].filter((id) => evidenceById.has(id)).map((id) => `- 「${evidenceById.get(id)!.title}」: ${evidenceById.get(id)!.summary}`);
  const recent = history.filter((m) => !m.status).slice(-14).map((m) => `${m.role === 'me' ? '수사관' : '수사팀'}: ${plain(m.text).replace(/\s+/g, ' ')}`);
  return [
    '[요청 카탈로그] (수사팀이 맡을 수 있는 조사 전부. start 후보)',
    ...catalog,
    '',
    '[막을 요청] (ID · 이런 요청 · 그 세계 안의 사실로 하는 말)',
    ...DEFLECTIONS.map((d) => `- ${d.id} · ${d.topic} · "${d.line}"`),
    CACHE_BREAK,
    '[확보한 자료] (수사관이 이미 받은 자료와 그 내용. 설명할 때 이 안의 사실만 쓴다)',
    ...(docs.length ? docs : ['(없음)']),
    // 조사 상태는 거의 매 턴 바뀌므로 캐시하지 않는 마지막 칸에 둔다 (2026-10-17 비용 분석: 수사팀 비용의 69%가 캐시 저장이었다)
    CACHE_BREAK,
    '[수사관이 들은 진술] (수사관이 면담에서 직접 들은 말. 수사팀도 공유받았다. 객관 기록이 아니라 그 사람의 진술이다)',
    ...(heard?.length ? heard : ['(없음)']),
    '',
    '[상태] (조사마다 지금 상태)',
    '현재 상태가 이전 대화보다 우선한다. 다른 조사에 포함되어 진행 중인 검사는 미착수라고 하지 않는다. 이미 받은 결과를 다시 맡거나, start에 없는 새 조사를 접수했다고 말하지 않는다.',
    ...INVESTIGATIONS.map((x) => `- ${x.id} 「${x.label}」: ${status(x.id, owned, jobs)}`),
    `진행 중인 조사: ${jobs.length}건 / 동시에 맡을 수 있는 최대 ${MAX_TEAM_JOBS}건`,
    '',
    '[최근 대화] (오래된 것부터)',
    ...(recent.length ? recent : ['(없음)']),
    '',
    '<수사관의 말>',
    noBreak(text.slice(0, MAX_DESK_INPUT)),
    '</수사관의 말>',
    ...(retry ? ['', `[다시 쓰기] ${retry}`] : []),
  ].join('\n');
}

export function sanitizeDesk(raw: unknown): DeskResult {
  const o = (raw ?? {}) as Record<string, unknown>;
  const arr = (v: unknown) => [...new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])];
  const known = new Set(INVESTIGATIONS.map((x) => x.id));
  const dkeys = new Set(DEFLECTIONS.map((d) => d.id));
  return {
    reply: typeof o.reply === 'string' ? o.reply.trim() : '',
    start: arr(o.start).filter((id) => known.has(id)),
    deflect: arr(o.deflect).filter((id) => dkeys.has(id)),
  };
}

/**
 * 조사 결과가 나오기까지의 시간을 약속하는 말 ("2분쯤 걸립니다", "30분 뒤에 결과가 나옵니다").
 * 자료에 적힌 시간 범위("사망 후 1시간 이내")는 걸지 않는다 (2026-10-17 플레이 리뷰: 부검 해석 답이 이 검사에 걸려 사라졌다)
 */
const WAIT_PROMISE_RE = /\d+\s*(분|시간|초)\s*(쯤|정도)?\s*((뒤|후|안|이내|만)에?\s*(결과|자료|회신|보고|나오|나올|나옵|도착|들어오|들어올|보내|알려|드리|드릴|끝나|끝날|완료)|(이|가)?\s*(걸립|걸려|걸릴|소요))|금방|곧바로 나옵|오래 걸/;

/**
 * 수사팀의 말 검사: 걸리는 시간, 범인 단정, 내부 ID, 너무 긴 말은 쓰지 않는다.
 * 숫자는 확보한 자료·대화·카탈로그에 있는 것만 쓴다 (아직 받지 않은 결과의 숫자를 지어내지 않게).
 * forbid: 아직 드러나지 않은 반전의 낱말 가운데 수사관이 꺼낸 적 없는 것 (deskForbid)
 */
export function safeDeskReply(reply: string, sheet: string, forbid: string[] = []): string | null {
  const t = reply.trim();
  // 세 사람 진술 정리는 길어질 수 있다 (2026-10-17 자동 점검: 약 1,000자 정리가 걸려 대체 문구가 나갔다)
  if (!t || t.length > 1200 || t.includes('⟦')) return null;
  if (/\b(GT-[ER]\d+|D-[a-z-]+)\b/.test(t)) return null;
  // 범인을 단정하는 말만 막는다 ("범인이 누구인지는 아직 단정할 단계가 아닙니다"는 괜찮다. 2026-10-17 대화 점검에서 이 말이 걸려 대체 문구가 나갔다)
  if (/(범인은\s*[가-힣]+\s*(씨|입니다|예요|이에요|이다)|[가-힣]+\s*(씨가|씨는)\s*범인|범인이\s*(맞|확실|분명)|진범|살해했|죽였습니다|죽인 사람은)/.test(t)) return null;
  if (WAIT_PROMISE_RE.test(t)) return null;
  if (forbid.some((w) => t.includes(w))) return null;
  // 진술의 "7시 50분"을 수사팀이 "19:50"으로 옮겨도 같은 시각이다 (2026-10-17 자동 점검: 진술 정리가 이 숫자 검사에 걸렸다)
  const clock = [...sheet.matchAll(/(\d{1,2})\s*시\s*(?:(\d{1,2})\s*분|반)?/g)].flatMap((m) => {
    const h = Number(m[1]) % 12, mm = String(m[2] ? Number(m[2]) : m[0].endsWith('반') ? 30 : 0).padStart(2, '0');
    return [`${h}:${mm}`, `${h + 12}:${mm}`, `${String(h).padStart(2, '0')}:${mm}`];
  });
  const flat = [sheet, ...clock].join(' ').replace(/\s/g, '');
  const nums = t.match(/\d[\d,:]*/g) ?? [];
  if (nums.some((n) => !flat.includes(n.replace(/[,:]$/, '')))) return null;
  return t;
}

/**
 * 수사팀이 먼저 꺼내면 안 되는 낱말 (2026-10-17 플레이 리뷰: 문자 원본도 받기 전에 "예약 발송인지 확인할 수 있다"고 했다).
 * 아직 풀리지 않은 반전의 낱말 가운데, 수사관이 이번 말·최근 대화에서 쓰지 않았고 들은 진술에도 없는 것.
 */
export function deskForbid(owned: Set<string>, allowed: string, docs = ''): string[] {
  return [
    ...forbiddenWords(owned).filter((w) => !allowed.includes(w)),
    // 카탈로그에만 있는 대상: 수사관이 자료·면담·대화로 알기 전에는 수사팀이 먼저 꺼내지 않는다 (흉기가 트로피라는 것도 드러난다)
    ...CATALOG_ONLY.filter((w) => !allowed.includes(w) && !docs.includes(w)),
  ];
}
const CATALOG_ONLY = ['트로피', '매입점', '온정귀금속'];

/**
 * 수사팀의 말 검사 (게임 teamChat과 점검 스크립트가 같이 쓴다). 숫자는 확보한 자료·카탈로그·막는 말·최근 대화·들은 진술·이번 말에 있는 것만,
 * 반전의 낱말은 수사관이 꺼낸 것만. 수사관의 말에 걸리는 막는 말(DEFLECTIONS)의 정해 둔 문장은 AI가 deflect를 빠뜨리고 그대로 옮겨도 통과시킨다
 * (2026-10-17 자동 점검: "cctv 있어요?"에 CCTV 안내 문장을 그대로 말했는데 그 안의 "매입점"이 걸려 두 번 모두 대체 문구가 나갔다).
 */
export function checkDeskReply(reply: string, { owned, said, recent, heard, deflect = [] }: { owned: Set<string>; said: string; recent: string; heard: string[]; deflect?: string[] }): string | null {
  const notes = DEFLECTIONS.filter((d) => deflect.includes(d.id) || d.re.test(said)).map((d) => d.line).join('\n');
  const sheet = [ownedSheet(owned), INVESTIGATIONS.map((x) => `${x.label} ${x.topic}`).join(' '), notes, recent, heard.join(' '), said].join('\n');
  return safeDeskReply(reply, sheet, deskForbid(owned, [recent, heard.join(' '), said, notes].join('\n'), ownedSheet(owned)));
}

/** 수사팀의 답이 검사에 걸렸을 때 다시 쓰게 하는 안내 */
export const DESK_RETRY = '앞선 답이 규칙에 걸렸다(조사에 걸리는 시간 약속, 수사관이 아직 꺼내지 않은 사건 가설이나 반전의 낱말, 자료에 없는 숫자 가운데 하나). 같은 질문에 다시 답한다. 이미 받은 자료를 묻는 질문이면 그 자료에 적힌 내용으로 답한다.';

export async function deskTalk(input: DeskInput): Promise<DeskResult> {
  const text = await callAI('desk', buildDeskPrompt(input), { attemptMs: 25000, hedgeMs: 12000, budgetMs: 45000, parse: (t) => { const o = JSON.parse(t); if (typeof o.reply !== 'string') throw new Error('reply 없음'); return o; } });
  return sanitizeDesk(JSON.parse(text));
}
