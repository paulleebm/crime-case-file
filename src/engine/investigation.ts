import { DEFLECTIONS, INVESTIGATIONS, SUMMARY_ID, investigationById } from '../data/investigations';
import { josa } from './josa';

// 수사팀 요청 처리. AI는 플레이어의 말을 카탈로그 ID로 옮기기만 하고, 무엇을 언제 넘길지는 여기서 정한다.
// 결과 문서는 고정 자료다. AI가 결과 내용을 지어내지 않는다.
// 조사는 하나씩 따로 진행된다(동시에 최대 MAX_TEAM_JOBS건). 모두 정한 시간이 지나면 도착한다.
// 남은 시간은 진행 막대로 보인다. 수사팀이 말로 하지는 않는다.

export type TeamKind = 'request' | 'summary' | 'clarify' | 'unsupported' | 'culprit' | 'deflect' | 'chat';

/** 플레이어 말의 해석 (AI 또는 낱말) */
export interface TeamInterpretation {
  kind: TeamKind;
  ids: string[];
  /** 요청이 아닐 때 수사팀이 할 말 (요약·되묻기 등) */
  reply?: string;
  /** 함께 들어 있던 막을 요청 (DEFLECTIONS의 ID) */
  deflect?: string[];
}

/** 진행 중인 조사 하나 */
export interface TeamJob {
  id: string;
  /** 조사 ID (GT-R..) */
  inv: string;
  outputs: string[];
  label: string;
  startedAt: number;
  /** 도착 시각 */
  dueAt: number;
  /** 조사하다 함께 나온 자료 (결과와 함께 넘긴다) */
  bonus?: string[];
  /** 수사관이 막혀 있을 때 수사팀이 먼저 나서서 맡은 조사 */
  proactive?: boolean;
}

export type PlanStatus = 'started' | 'already_owned' | 'running' | 'redirect' | 'busy' | 'none';

/** 수사팀이 동시에 맡는 조사 수 (2026-10-16: 한꺼번에 다 맡기지 않고 무엇이 필요한지 고르게) */
export const MAX_TEAM_JOBS = 3;

export interface TeamPlan {
  status: PlanStatus;
  /** 새로 시작하는 조사 */
  jobs: TeamJob[];
  /** 이미 가진 자료 (다시 열어 볼 수 있게 링크로 보여 준다) */
  owned: string[];
  text: string;
}

/** 조사의 결과를 이미 모두 가졌는가 */
const covered = (id: string, owned: Set<string>) => investigationById.get(id)!.outputs.every((o) => owned.has(o));

export function requestStatus(id: string, owned: Set<string>, running: TeamJob[]): 'already_owned' | 'running' | 'available' {
  if (covered(id, owned)) return 'already_owned';
  const pending = new Set(running.flatMap((job) => job.outputs));
  return investigationById.get(id)!.outputs.every((output) => owned.has(output) || pending.has(output)) ? 'running' : 'available';
}

/** 요청한 조사에 선행 조사를 붙이고 겹치는 것을 정리한다 (실물을 먼저 확보해야 하는 조사는 그 확보를 앞에 둔다) */
export function expandRequest(ids: string[], owned: Set<string>): string[] {
  const want = [...new Set(ids.filter((id) => investigationById.has(id) && !investigationById.get(id)!.redirect))];
  const out: string[] = [];
  const add = (id: string, seen: Set<string>) => {
    if (seen.has(id) || out.includes(id)) return;
    seen.add(id);
    for (const d of investigationById.get(id)!.dependencies ?? []) if (!covered(d, owned)) add(d, seen);
    out.push(id);
  };
  for (const id of want) add(id, new Set());
  // 다른 조사의 결과에 모두 들어 있는 조사는 뺀다 (인물 대조를 하면 밑면 검사도 함께 나온다)
  const outs = (id: string) => investigationById.get(id)!.outputs;
  return out.filter((id) => !out.some((o) => o !== id && outs(id).every((x) => outs(o).includes(x)) && outs(o).length > outs(id).length));
}

/** 요청을 받았을 때의 처리 계획과 수사팀의 첫 대답 */
export function planRequest(ids: string[], owned: Set<string>, running: TeamJob[] = [], now = Date.now()): TeamPlan {
  const asked = [...new Set(ids)].map((id) => investigationById.get(id)).filter((d) => !!d?.redirect);
  const redirects = asked.filter((d) => !d!.redirectDoc || !owned.has(d!.redirectDoc));
  const handed = asked.filter((d) => d!.redirectDoc && owned.has(d!.redirectDoc)).map((d) => d!.redirectDoc!);
  const all = expandRequest(ids, owned);
  const run = all.filter((id) => requestStatus(id, owned, running) === 'available');
  const already = all.filter((id) => requestStatus(id, owned, running) === 'running');
  const have = [...new Set(all.flatMap((id) => investigationById.get(id)!.outputs).filter((o) => owned.has(o)))];
  const redirectText = redirects.map((d) => d!.redirect!).join('\n');
  if (!all.length) {
    if (redirectText) return { status: 'redirect', jobs: [], owned: [], text: redirectText };
    if (handed.length) return { status: 'already_owned', jobs: [], owned: handed, text: '그 자료는 이미 자료함에 있습니다. 아래에서 바로 열어 보실 수 있습니다.' };
    return { status: 'none', jobs: [], owned: [], text: '' };
  }
  if (!run.length) {
    const text = already.length
      ? `${josa(already.map((id) => investigationById.get(id)!.label).join(', '), '은/는')} 이미 진행하고 있습니다. 결과가 나오면 바로 알려 드리겠습니다.`
      : '그 결과는 이미 자료함에 있습니다. 아래에서 바로 열어 보실 수 있습니다.';
    return { status: already.length ? 'running' : 'already_owned', jobs: [], owned: have, text: [text, redirectText].filter(Boolean).join('\n') };
  }
  const slots = Math.max(0, MAX_TEAM_JOBS - running.length);
  const labels = (ids: string[]) => ids.map((id) => investigationById.get(id)!.label).join(', ');
  if (!slots) {
    const text = `지금 조사 ${MAX_TEAM_JOBS}건을 진행하고 있어 더 맡기 어렵습니다.\n하나가 끝나면 ${josa(labels(run), '을/를')} 다시 말씀해 주세요.`;
    return { status: 'busy', jobs: [], owned: have, text: [text, redirectText].filter(Boolean).join('\n') };
  }
  // 선행 조사가 앞에 있으므로 앞에서부터 자르면 확보 순서가 지켜진다
  const left = run.slice(slots);
  const jobs = run.slice(0, slots).map((id, i): TeamJob => {
    const d = investigationById.get(id)!;
    const bonus = (d.bonus ?? []).filter((o) => !owned.has(o) && !d.outputs.includes(o));
    return { id: `job${now.toString(36)}${i}`, inv: id, outputs: d.outputs.filter((o) => !owned.has(o)), label: d.label, startedAt: now, dueAt: now + d.delayMs, ...(bonus.length ? { bonus } : {}) };
  });
  const auto = run.slice(0, slots).filter((id) => !ids.includes(id));
  const lines = [
    '알겠습니다.',
    ...jobs.map((j) => {
      const d = investigationById.get(j.inv)!;
      return `${d.ack}.`;
    }),
    ...(auto.length ? [`대상 물건과 원본을 먼저 확보해야 해서 ${auto.map((id) => investigationById.get(id)!.label).join(', ')}도 함께 맡았습니다.`] : []),
    ...(already.length ? [`${josa(already.map((id) => investigationById.get(id)!.label).join(', '), '은/는')} 이미 진행 중입니다.`] : []),
    ...(left.length ? [`조사는 한 번에 ${MAX_TEAM_JOBS}건까지 맡습니다. ${josa(labels(left), '은/는')} 진행 중인 조사가 끝나면 다시 말씀해 주세요.`] : []),
    ...(have.length ? ['이미 받은 자료는 다시 조회하지 않습니다.'] : []),
    ...(redirectText ? [redirectText] : []),
    '결과가 나오는 대로 알려 드리겠습니다.',
  ];
  return { status: 'started', jobs, owned: have, text: lines.join('\n') };
}

/** 도착 시각. 조건을 기다리던 옛 저장(dueAt이 비어 있음)은 요청 시각에 소요 시간을 더한다 */
export const jobDueAt = (j: TeamJob) => j.dueAt ?? j.startedAt + (investigationById.get(j.inv)?.delayMs ?? 0);

/** 시계가 할 일: 시간이 된 조사 넘기기 */
export function tickJobs(jobs: TeamJob[], now = Date.now()): string[] {
  return jobs.filter((j) => now >= jobDueAt(j)).map((j) => j.id);
}

// ─────────────── 수사팀이 먼저 나서기 ───────────────
// 수사관이 한동안 새 자료도 새 진술도 얻지 못하고 맡긴 조사도 없으면, 수사팀이 다음에 쓸 만한 조사를 먼저 맡아 결과를 보낸다.
// 휴대폰 분석은 PROACTIVE_ORDER에 넣지 않는다 (예약 등록 시점은 수사관이 짚어야 한다).

/** 진전이 없을 때 수사팀이 먼저 맡는 순서 (이야기의 권장 흐름) */
export const PROACTIVE_ORDER = INVESTIGATIONS.some(i => i.id === 'scene') ? ['scene', 'access', 'taxi', 'call'] : ['GT-R03', 'GT-R04', 'GT-R01', 'GT-R06', 'GT-R16', 'GT-R07', 'GT-R09', 'GT-R10', 'GT-R14', 'GT-R08'];
/** 이만큼 진전이 없으면 먼저 나선다 */
export const PROACTIVE_AFTER = 3 * 60_000;
/** 먼저 맡은 조사가 도착하기까지 */
export const PROACTIVE_DELAY = 8_000;

export function proactivePick(owned: Set<string>, running: TeamJob[]): string | null {
  if (running.length) return null;
  for (const id of PROACTIVE_ORDER) {
    const d = investigationById.get(id)!;
    if (covered(id, owned)) continue;
    if ((d.dependencies ?? []).some((x) => !covered(x, owned))) continue;
    return id;
  }
  return null;
}

/** 먼저 맡은 조사 하나 */
export function proactiveJob(id: string, owned: Set<string>, now = Date.now()): TeamJob {
  const d = investigationById.get(id)!;
  const bonus = (d.bonus ?? []).filter((o) => !owned.has(o) && !d.outputs.includes(o));
  return { id: `pro${now.toString(36)}`, inv: id, outputs: d.outputs.filter((o) => !owned.has(o)), label: d.label, startedAt: now, dueAt: now + PROACTIVE_DELAY, proactive: true, ...(bonus.length ? { bonus } : {}) };
}

// ─────────────── AI 없이 고르기 (AI가 닿지 않을 때와 테스트에 쓴다) ───────────────

const ALL_RE = /(전부|모두|모든|전체|싹\s?다|몽땅|있는\s?대로).{0,8}(자료|원본|조사|기록|감정|줘|주세요|확인)|(자료|기록|원본|것|거)\s?다\s?(줘|주세요|보내|넘겨)|^(그냥\s?)?다\s?(줘|주세요|보내)/;
const CULPRIT_RE = /(범인|누가\s?죽였|누가\s?범행|누구\s?짓)/;
const SUMMARY_RE = /(요약|정리해|지금까지|확보한\s?(기록|자료)|왜\s?의심)/;

const VAGUE_PHONE_RE = /(휴대폰|핸드폰|폰|스마트폰).{0,10}(분석|포렌식|조사|뽑아|확인|봐)|포렌식/;
export const PHONE_CLARIFY = '회장님 휴대폰 원본은 양이 많아 무엇을 찾을지 정해야 합니다.\n통화와 녹음, 주고받은 문자, 메시지 발송 설정 기록 가운데 어느 쪽을 볼까요?\n특정 메시지가 있으면 그 메시지의 무엇을 확인할지도 말씀해 주세요.';

export const ALL_CLARIFY = `자료를 한꺼번에 다 조회하기는 어렵습니다.\n어떤 기록이나 감정이 필요한지 구체적으로 말씀해 주세요. 한 번에 ${MAX_TEAM_JOBS}건까지 맡겠습니다.`;

/** 낱말로 요청을 고른다. 고를 수 없으면 clarify */
export function matchRequest(text: string): TeamInterpretation {
  const t = text.replace(/\s+/g, ' ');
  // 막을 요청(CCTV 등)이 섞여 있어도 할 수 있는 조사는 맡는다
  const deflect = DEFLECTIONS.filter((d) => d.re.test(t)).map((d) => d.id);
  const extra = deflect.length ? { deflect } : {};
  const hits = INVESTIGATIONS.map((x) => ({ id: x.id, n: x.aliases.filter((a) => t.includes(a)).length })).filter((h) => h.n > 0);
  // 휴대폰을 분석하자면서 무엇을 볼지 짚지 않았으면 범위를 되묻는다 ("휴대폰 전체"도. desk 프롬프트 1-1과 같은 기준).
  // 회장 휴대폰 분석은 예약 등록 시점을 짚었을 때만 낱말이 맞는다
  if (VAGUE_PHONE_RE.test(t) && !hits.length && !/(태준|총지배인)/.test(t)) return { kind: 'clarify', ids: [], reply: PHONE_CLARIFY, ...extra };
  // 무엇을 볼지 없이 "다 주세요"라고 하면 맡지 않고 구체적으로 되묻는다
  if (ALL_RE.test(t) && !hits.length) return { kind: 'clarify', ids: [], reply: ALL_CLARIFY, ...extra };
  if (hits.length) return { kind: 'request', ids: hits.map((h) => h.id), ...extra };
  if (deflect.length) return { kind: 'deflect', ids: [], deflect };
  if (CULPRIT_RE.test(t)) return { kind: 'culprit', ids: [] };
  if (SUMMARY_RE.test(t)) return { kind: 'summary', ids: [SUMMARY_ID] };
  return { kind: 'clarify', ids: [] };
}
