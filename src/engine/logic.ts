import { ALT_QUESTIONS, CHALLENGES, CULPRIT, FACTS, REPORT_QUESTIONS, STATEMENTS, isNoCulprit, personOf } from '../data/case';
import { FEEDBACK } from '../data/hints';
import type { Fact, PersonId } from '../data/types';
import { hasClue, plain } from '../data/clues';
import { linesOf } from '../data/tone';
import { STATEMENT_FORMS, sectionBy } from '../data/statementForms';
import { claimId, factsOfClue, sourceId, visibleClaims } from './claims';
import { settled } from './hints';
import { cluesOfDoc, condMet, factById, nameOf, statementById } from './lookup';
import type { ReportDraft, ReportResult } from './state';

/** casual: 목록에 없고 사건과도 무관한 사소한 질문 (AI가 인물로서 자유롭게 답한다) */
export type SegmentKind = 'challenge' | 'question' | 'detail' | 'restate' | 'clarify' | 'offtopic' | 'casual';

/** 플레이어 발화 한 덩어리. 한 메시지에 질문 여러 개나 질문+지적이 섞이면 여러 개가 된다 */
export interface Segment {
  kind: SegmentKind;
  targetClaimIds: string[];
  citedEvidenceIds: string[];
  factIds: string[];
  /** 고른 주제의 답이 물은 것에 바로 답하는가. false면 진행에 필요한 답이 아닌 한 인물이 직접 쓴다 */
  direct?: boolean;
  /** 고른 답에서 물은 정보를 담은 구절 (AI가 옮겨 적는다. 답에 실제로 있어야 direct로 본다) */
  quote?: string;
  /** 형사가 직접 맞댄 지적: 고른 말과 붙인 근거로만 판정한다 (다른 논점으로 넓혀 읽지 않는다) */
  exact?: boolean;
  /** 근거만 내밀었다: 짚은 말 없이, 그 근거가 무너뜨리는 이 사람의 숨긴 이야기를 찾아 판정한다 */
  rough?: boolean;
}

export interface Interpretation {
  segments: Segment[];
  confidence: number;
  /** 해석과 함께 받은 대사: 고른 준비된 답(facts)을 인물의 말로 지은 것. 엔진이 같은 답을 골랐을 때만 쓴다 */
  reply?: { text: string; facts: string[] };
  /** 근거를 상대의 말에 맞대지 않고 말로만 지적했다 (판정하지 않고 맞대는 법을 알려 준다) */
  unpinned?: boolean;
}

export interface Part { text: string; source?: string }

export interface Outcome {
  kind: 'success' | 'nearMiss' | 'irrelevant' | 'repeat' | 'fact' | 'unknown' | 'clarify' | 'offtopic' | 'casual' | 'written';
  parts: Part[];
  /** 사소한 질문이 섞여 있어 AI가 인물로서 짧게 답을 붙여야 한다 */
  casual?: boolean;
  reveals: string[];
  basis: string[];
  done?: string;
  /** 함께 끝나는 지적 (자백하면 남은 곁가지 거짓말도 끝난다) */
  closes?: string[];
  record?: string;
  /** 이 논점(지적 ID)에 이번에 새로 제시해 남겨 둘 근거 */
  press?: Record<string, string[]>;
  /** 수사 수첩에 남길 짧은 피드백: 무엇이 통했고 무엇이 모자란지 */
  feedback?: string;
  /** 이번에 답한 주제 (다음 말에서 같은 주제를 바로 또 물었는지 가리는 데 쓴다) */
  facts?: string[];
  /** 사건에 관한 질문인데 준비된 답이 없다. 인물이 상황 설정을 읽고 직접 답을 쓴다 (못 쓰면 parts의 모른다는 말) */
  free?: boolean;
  /** 진술이 바뀐 지적에서 받아들여진 근거 조합 (진술 이력에 남긴다) */
  used?: string[];
  /** 통한 뒤 수사 수첩에 남길 한 줄 */
  note?: string;
  /** 거짓말을 하기 전에 근거를 먼저 내밀어, 숨기려던 일을 처음부터 털어놓았다 (정정이 아니다) */
  volunteer?: boolean;
}

/** 정정되는 순간 대화창에서 하는 말: 짧은 대사가 있으면 그것, 없으면 진술 원문 */
export const sayOf = (id: string) => { const st = statementById.get(id)!; return st.say ?? st.text; };

/** 논점별로 앞서 제시해 둔 근거 (지적 ID → 근거 ID) */
export type Pressed = Record<string, string[]>;

/** "처음부터 다시"를 분명히 요청하는 말 */
const EXPLICIT_RESTATE = /(처음부터|다시 (한번 )?(말|정리|얘기|이야기)|진술(을)? 다시|정리해 (줘|주세요|보세요)|전부 다시)/;

/** 한 번에 답하는 질문 수 상한 */
export const MAX_ANSWERS = 3;

/**
 * 한 메시지에서 근거로 들 수 있는 출처 수 상한 (같은 사람의 말은 하나로 센다).
 * 지적에 필요한 근거 조합은 많아야 4개다. 그보다 많이 늘어놓으면 추리가 아니라 찍기로 보고 판정하지 않는다.
 */
export const MAX_CITED = 4;

export function citedSources(person: PersonId, segs: Segment[], owned: Set<string>): Set<string> {
  const ids = segs.flatMap((s) => s.citedEvidenceIds).map(sourceId).filter((id) => owned.has(id) && personOf(id) !== person);
  return new Set(ids.map((id) => personOf(id) ?? id));
}

/** 방금 한 말은 되도록 다시 고르지 않는다 (같은 반박이 연달아 나오면 벽에 대고 말하는 느낌이 든다) */
let recentLines: string[] = [];
const pick = (arr: string[]) => {
  const fresh = arr.filter((t) => !recentLines.includes(t));
  const pool = fresh.length ? fresh : arr;
  return pool[Math.floor(Math.random() * pool.length)];
};
const line = (kind: Outcome['kind'], text: string, feedback?: string): Outcome => ({ kind, parts: [{ text }], reveals: [], basis: [], ...(feedback ? { feedback } : {}) });

/** 진술서 칸을 채우는 답 → 그 사람의 원 진술 ID */
const formOf = new Map<string, string>(Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((s) => sectionBy(s).map((id) => [id, f.statementId] as [string, string]))));

/** 진술서 칸을 채우거나 기록부에 남는 답인가 (들었으면 근거로 쓸 수 있어야 한다) */
const counts = (f: Fact) => f.record || formOf.has(f.id);

/** 말에 이 답의 주제어가 있는가 */
const topicHit = (f: Fact, said: string) => !!said && f.keywords.some((k) => k.length >= 2 && said.includes(k));

const norm = (t: string) => plain(t).replace(/[\s“”"'.,…?!~]/g, '');
const bigrams = (t: string) => { const out = new Set<string>(); for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2)); return out; };
/** a의 글자쌍 가운데 b에 있는 비율 */
const covered = (a: string, b: string) => { const x = bigrams(a), y = bigrams(b); if (!x.size) return 0; let n = 0; for (const g of x) if (y.has(g)) n++; return n / x.size; };

/**
 * 인물이 직접 쓴 답이 사실은 준비된 답을 그대로 말한 것이면 그 답을 찾는다.
 * (“다툰 적 있나요?”에 준비된 부인을 그대로 말했는데 기록되지 않으면, 들은 말을 반박할 수 없다)
 * 근거 문장이 있는 답은 근거 문장이 모두, 없는 답은 답의 대부분이 쓴 답에 들어 있어야 한다. 자료를 넘기는 답은 잇지 않는다.
 */
export function linkWritten(person: PersonId, written: string, owned: Set<string>): Fact | null {
  const w = norm(written);
  const hits = allowedFacts(person, owned).filter((f) => !owned.has(f.id) && counts(f) && !f.reveals?.length).filter((f) => {
    return [f.answer, ...(f.alt ?? [])].some((a) => {
      const clues = [...a.matchAll(/⟦[^|⟧]+\|([^⟧]+)⟧/g)].map((m) => norm(m[1]));
      return clues.length ? clues.every((c) => covered(c, w) >= 0.85) : covered(norm(a), w) >= 0.8;
    });
  });
  return hits[0] ?? null;
}

/** AI가 답을 쓰지 못했을 때: 말에 주제어가 가장 많이 든, 아직 듣지 않은 준비된 답 (주제어가 없으면 null) */
export function keywordFact(person: PersonId, said: string, owned: Set<string>): Fact | null {
  const score = (f: Fact) => f.keywords.filter((k) => k.length >= 2 && said.includes(k)).length;
  const fs = allowedFacts(person, owned).filter((f) => !owned.has(f.id) && !f.topic.startsWith('[') && score(f) > 0);
  return fs.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** 진술서에 남는 답을 들었을 때 함께 생기는 것: 그 답과, 처음 채워지는 진술서 */
export function heardReveals(f: Fact, owned: Set<string>): string[] {
  const base = formOf.get(f.id);
  return [f.id, ...(base && !owned.has(base) ? [base] : [])];
}

/** 기록되는 답변에 근거 표기가 없으면 답 전체를 근거 문장 하나로 만든다 */
function asClue(factId: string, text: string): string {
  return hasClue(text) ? text : `⟦${factId}.1|${text}⟧`;
}

/** 지금 단계에서 유효한 답변들 (cond 충족, until 미충족) */
export function allowedFacts(person: PersonId, owned: Set<string>): Fact[] {
  return FACTS.filter((f) => f.person === person && condMet(f.cond, owned) && !(f.until && condMet(f.until, owned)));
}

/**
 * 처음부터 다시 말할 때 쓰는 말: 진술서 순서대로, 그 사람에게서 들은 답의 지금 단계 버전.
 * 이미 정정한 내용은 정정한 대로 말한다. 많아야 네 가지만 이어 말한다.
 */
export function toldSoFar(person: PersonId, owned: Set<string>): string[] {
  const allowed = allowedFacts(person, owned);
  const out: string[] = [];
  for (const sec of STATEMENT_FORMS[person].sections) for (const p of sec.paras) {
    const heard = p.by.find((id) => owned.has(id));
    if (!heard) continue;
    const key = factById.get(heard)?.topicKey;
    const now = (key && allowed.find((f) => f.topicKey === key)) || factById.get(heard)!;
    const t = plain(now.answer);
    if (!out.includes(t)) out.push(t);
  }
  // 진술서에 들어갈 이야기를 아직 하지 않았으면, 지금까지 대화에서 한 답을 최근 것부터 다시 말한다
  if (!out.length) {
    const heard = [...owned].filter((id) => factById.get(id)?.person === person).slice(-3);
    for (const id of heard) {
      const key = factById.get(id)!.topicKey;
      const now = (key && allowed.find((f) => f.topicKey === key)) || factById.get(id)!;
      const t = plain(now.answer);
      if (!out.includes(t)) out.push(t);
    }
  }
  return out.slice(0, 4);
}

export function latestStatement(person: PersonId, owned: Set<string>) {
  return [...STATEMENTS].reverse().find((s) => s.person === person && owned.has(s.id));
}

/**
 * 어떤 사람의 말을 근거로 들면 그 사람이 지금까지 한 진술·답변 전체를 근거로 본다.
 * ("한서윤 씨 말로는…"이 초기 진술인지 대화 중 답변인지까지 맞히라고 요구하지 않는다)
 */
function widenWitness(ids: string[], owned: Set<string>): Set<string> {
  const out = new Set(ids.filter((id) => owned.has(id)));
  const witnesses = new Set(ids.filter((id) => statementById.has(id) || factById.has(id)).map(personOf));
  for (const id of owned) {
    const p = personOf(id);
    if (p && witnesses.has(p) && (statementById.has(id) || factById.get(id)?.record)) out.add(id);
  }
  return out;
}

/** 이 지적에 쓰일 수 있는 근거 전체 */
const reqIds = (c: (typeof CHALLENGES)[number]) => new Set(c.requires.flat());

/**
 * 지적 판정. 진술이 바뀌려면 두 가지가 다 맞아야 한다.
 * 1. 어떤 말이 거짓인지: 그 사람의 문장(진술서 근거 문장이나 기록된 답변)을 정확히 짚었다.
 * 2. 무엇과 부딪히는지: 그 거짓을 깨는 근거 조합을 들었다.
 * 같은 논점에 앞서 제시해 둔 근거(pressed)는 이번 말의 근거와 합쳐 판정한다.
 * 자료만 언급하거나, 엉뚱한 문장을 짚으면 진술은 바뀌지 않는다.
 */
function resolveChallenge(person: PersonId, seg: Segment, attached: string[], owned: Set<string>, done: Set<string>, pressed: Pressed): Outcome {
  const lines = linesOf(person, owned);
  const claims = visibleClaims(person, owned);
  const visible = new Set(claims.map((c) => c.id));
  const struckIds = new Set(claims.filter((c) => c.struck).map((c) => c.id));
  const targets = [...new Set([...seg.targetClaimIds, ...attached].map(claimId))].filter((id) => visible.has(id));
  // 근거: 자료·진술 단위와, 짚어 낸 근거 문장 단위 둘 다 (어떤 지적은 자료 속 특정 문장을 요구한다)
  // 직접 맞댄 근거는 내민 그대로만 본다 (같은 사람의 다른 말로 넓혀 읽지 않는다)
  const raw = [...seg.citedEvidenceIds, ...attached];
  const units = seg.exact ? new Set(raw.map(sourceId).filter((id) => owned.has(id))) : widenWitness(raw.map(sourceId), owned);
  // 자료를 통째로 내밀면 그 자료의 근거 문장을 모두 든 것으로 본다
  const provided = new Set([...units, ...raw.filter((id) => id !== sourceId(id) && owned.has(sourceId(id))), ...raw.flatMap((id) => factsOfClue(id, owned)), ...raw.filter((id) => owned.has(id)).flatMap(cluesOfDoc)]);
  if (!targets.length) return line('clarify', pick(settled(person, done) ? lines.settled : lines.clarify), settled(person, done) ? undefined : provided.size ? FEEDBACK.noTargetWithEvidence : FEEDBACK.noTarget);
  // 이 사람이 이미 인정해 진술서에 남은 말 (부분 인정이 쌓여야 열리는 지적의 근거가 된다)
  const admitted = [...owned].filter((id) => statementById.has(id) && personOf(id) === person);
  // 이 논점의 근거 = 이번에 든 근거 + 앞서 이 논점에 제시해 둔 근거 (아직 가진 것만) + 이미 인정한 말
  const pool = (c: (typeof CHALLENGES)[number]) => new Set([...provided, ...(pressed[c.id] ?? []).filter((id) => owned.has(sourceId(id))), ...admitted]);
  const satisfied = (reqs: string[][], have: Set<string>) => reqs.find((set) => set.every((id) => have.has(id)));
  let candidates = CHALLENGES.filter((c) => c.person === person && c.targets.some((t) => owned.has(t)) && c.lies.some((l) => targets.includes(l)));
  // 짚은 말의 논점과 상관없는 근거를 냈는데, 그 근거가 다른 미해결 주장을 그대로 깨뜨리면 그 주장을 짚은 것으로 본다.
  // ("21:06 같은 글이 당신 휴대폰에 있었다"는 근거를 전화 이야기에 붙여도 글의 출처 논점으로 읽는다)
  // 진상 공개 조건은 그대로다: 그 논점의 근거 조합을 이번 말의 근거로 모두 갖춰야 하고, 그 논점의 거짓말이 지금 보이는 말이어야 한다.
  const openTargeted = candidates.filter((c) => !done.has(c.id));
  const fresh = [...provided].filter((id) => !(personOf(id) === person && statementById.has(id)));
  const offTopic = fresh.length > 0 && fresh.every((id) => !openTargeted.some((c) => reqIds(c).has(id)));
  // 짚은 말이 아직 다투는 방어(미해결 논점의 거짓말)일 때만 넓힌다. 사실인 말을 짚었으면 근거가 맞아도 통하지 않는다
  if (!seg.exact && openTargeted.length && offTopic && !openTargeted.some((c) => satisfied(c.requires, pool(c)))) {
    const live = new Set(claims.filter((c) => !c.struck).map((c) => c.id));
    const wider = CHALLENGES
      .filter((c) => c.person === person && !done.has(c.id) && c.targets.some((t) => owned.has(t)) && !candidates.includes(c))
      .filter((c) => c.lies.some((l) => live.has(l)))
      .map((c) => ({ c, set: c.requires.find((set) => set.every((id) => provided.has(id) || (pressed[c.id] ?? []).includes(id))) }))
      .filter((x): x is { c: (typeof CHALLENGES)[number]; set: string[] } => !!x.set && x.set.some((id) => provided.has(id)))
      .sort((a, b) => b.set.filter((id) => provided.has(id)).length - a.set.filter((id) => provided.has(id)).length);
    if (wider.length) candidates = [wider[0].c, ...candidates];
  }
  if (!candidates.length) return line('irrelevant', pick(settled(person, done) ? lines.settled : lines.nearMiss), settled(person, done) ? FEEDBACK.settled : targets.every((id) => struckIds.has(id)) ? FEEDBACK.struck : FEEDBACK.unrelated);
  const open = candidates.filter((c) => !done.has(c.id));
  for (const c of open) {
    const set = satisfied(c.requires, pool(c));
    if (set) {
      const st = c.reveals.find((id) => statementById.has(id))!;
      const press: Record<string, string[]> = {};
      const keep = (id: string, ids: string[]) => { if (ids.length) press[id] = [...new Set([...(press[id] ?? []), ...ids])]; };
      // 중간 단계의 지적이면, 쓴 근거를 새 변명을 겨냥하는 다음 지적에 남겨 둔다 ("지문" 다음에 "잔 교체"만 말해도 이어진다)
      if (c.carry) for (const n of CHALLENGES.filter((x) => x.id !== c.id && !done.has(x.id) && x.targets.some((t) => c.reveals.includes(t))))
        keep(n.id, set.filter((id) => reqIds(n).has(id)));
      // 같은 진술의 다른 방어를 겨냥하는 지적에는, 이번에 함께 든 근거를 남겨 둔다 (한꺼번에 말한 연결을 다시 말하게 하지 않는다)
      for (const n of CHALLENGES.filter((x) => x.id !== c.id && x.person === person && !done.has(x.id) && x.targets.some((t) => c.targets.includes(t))))
        keep(n.id, [...provided].filter((id) => reqIds(n).has(id) && !(pressed[n.id] ?? []).includes(id)));
      // 앞서 낸 근거가 있어야 통했다면, 지금 한 말과 대답이 어긋나 보이지 않게 그 연결을 먼저 인정한다
      const usedEarlier = set.some((id) => !provided.has(id));
      const parts: Part[] = [...(usedEarlier ? [{ text: pick(lines.combine) }] : []), { text: c.reply ?? sayOf(st), source: st }];
      return { kind: 'success', parts, reveals: c.reveals, basis: [...targets, ...set], used: set, done: c.id, closes: c.closes, record: st, ...(c.note ? { note: c.note } : {}), ...(Object.keys(press).length ? { press } : {}) };
    }
  }
  // 숨기던 것을 다 털어놓은 사람은 더 버티지 않는다
  if (settled(person, done)) return line('repeat', pick(lines.settled), FEEDBACK.settled);
  // 이번에 든 근거 가운데 이 논점에 쓰일 수 있는 것은 남겨 둔다 (다음 말에서 보태면 된다)
  const press: Record<string, string[]> = {};
  for (const c of open) {
    const add = [...provided].filter((id) => reqIds(c).has(id) && !(pressed[c.id] ?? []).includes(id));
    if (add.length) press[c.id] = add;
  }
  const withPress = (o: Outcome): Outcome => (Object.keys(press).length ? { ...o, press } : o);
  // 근거가 일부만 맞으면 그 근거에 맞춘 말로 버틴다 (무엇이 더 필요한지 짐작할 수 있게).
  // 이번에 든 근거에 대한 반박을 먼저 고른다 (지문을 내밀었는데 초안 이야기로 받아치지 않게)
  const partials = open.flatMap((c) => { const have = pool(c); return (c.partial ?? []).filter((x) => x.has.every((id) => have.has(id))); });
  const p = partials.find((x) => x.has.some((id) => provided.has(id))) ?? partials[0];
  if (p) return withPress(line('nearMiss', p.reply, p.feedback ?? FEEDBACK.accepted(p.has.map(nameOf))));
  if (candidates.some((c) => done.has(c.id) && satisfied(c.requires, provided))) return line('repeat', pick(lines.repeat), FEEDBACK.repeat);
  const accepted = open.flatMap((c) => [...pool(c)].filter((id) => reqIds(c).has(id)));
  if (accepted.length) return withPress(line('nearMiss', pick(lines.nearMiss), FEEDBACK.accepted([...new Set(accepted)].map(nameOf))));
  // 이미 정정된 말만 짚었으면 그 사실을 알려 준다 (근거가 틀렸다고 오해하지 않게)
  if (targets.every((id) => struckIds.has(id))) return line('nearMiss', pick(lines.nearMiss), FEEDBACK.struck);
  return line('nearMiss', pick(lines.nearMiss), provided.size ? FEEDBACK.unrelated : FEEDBACK.noEvidence);
}

/**
 * 근거만 내민 지적 (짚은 말 없음). 그 근거로 무너지는 이 사람의 숨긴 이야기를 찾는다.
 * - 이 단계에서 다툴 수 있는 논점: 앞 단계 진술을 이미 받았거나, 이 사람의 처음 이야기를 다루는 논점.
 * - 여러 논점이 맞으면 근거를 더 많이 요구하는 논점(더 깊은 인정)을 고른다. 이번에 낸 근거가 하나는 들어 있어야 한다.
 * - 그 논점의 거짓말을 아직 한마디도 듣지 않았으면, 거짓말 없이 바로 털어놓는다 (정정이 아니다).
 */
function resolveRough(person: PersonId, seg: Segment, owned: Set<string>, done: Set<string>, pressed: Pressed): Outcome {
  const lines = linesOf(person, owned);
  if (settled(person, done)) return line('repeat', pick(lines.settled), FEEDBACK.settled);
  const raw = seg.citedEvidenceIds;
  const provided = new Set([...raw.map(sourceId).filter((id) => owned.has(id)), ...raw.filter((id) => id !== sourceId(id) && owned.has(sourceId(id))), ...raw.flatMap((id) => factsOfClue(id, owned)), ...raw.filter((id) => owned.has(id)).flatMap(cluesOfDoc)]);
  if (!provided.size) return line('clarify', pick(lines.clarify), FEEDBACK.noEvidence);
  const admitted = [...owned].filter((id) => statementById.has(id) && personOf(id) === person);
  const pool = (c: (typeof CHALLENGES)[number]) => new Set([...provided, ...(pressed[c.id] ?? []).filter((id) => owned.has(sourceId(id))), ...admitted]);
  const base = STATEMENT_FORMS[person].statementId;
  const eligible = CHALLENGES.filter((c) => c.person === person && !done.has(c.id) && (c.targets.some((t) => owned.has(t)) || c.targets.includes(base)));
  const fresh = (set: string[]) => set.some((id) => provided.has(id));
  const hit = eligible
    .map((c) => ({ c, set: c.requires.find((set) => set.every((id) => pool(c).has(id)) && fresh(set)) }))
    .filter((x): x is { c: (typeof CHALLENGES)[number]; set: string[] } => !!x.set)
    .sort((a, b) => b.set.length - a.set.length)[0];
  if (hit) {
    const { c, set } = hit;
    const st = c.reveals.find((id) => statementById.has(id))!;
    const heard = new Set(visibleClaims(person, owned).map((x) => x.id));
    const volunteer = !c.lies.some((l) => heard.has(l));
    const press: Record<string, string[]> = {};
    const keep = (id: string, ids: string[]) => { if (ids.length) press[id] = [...new Set([...(press[id] ?? []), ...ids])]; };
    if (c.carry) for (const n of CHALLENGES.filter((x) => x.id !== c.id && !done.has(x.id) && x.targets.some((t) => c.reveals.includes(t))))
      keep(n.id, set.filter((id) => reqIds(n).has(id)));
    for (const n of CHALLENGES.filter((x) => x.id !== c.id && x.person === person && !done.has(x.id) && x.targets.some((t) => c.targets.includes(t))))
      keep(n.id, [...provided].filter((id) => reqIds(n).has(id) && !(pressed[n.id] ?? []).includes(id)));
    const usedEarlier = set.some((id) => !provided.has(id) && !admitted.includes(id));
    const parts: Part[] = [...(usedEarlier ? [{ text: pick(lines.combine) }] : []), { text: c.reply ?? sayOf(st), source: st }];
    return { kind: 'success', parts, reveals: c.reveals, basis: set, used: set, done: c.id, closes: c.closes, record: st, ...(volunteer ? { volunteer: true } : {}), ...(c.note ? { note: c.note } : {}), ...(Object.keys(press).length ? { press } : {}) };
  }
  // 이번 근거 가운데 다툴 논점에 쓰일 수 있는 것은 남겨 둔다 (모자란 근거만 보태면 된다)
  const press: Record<string, string[]> = {};
  for (const c of eligible) {
    const add = [...provided].filter((id) => reqIds(c).has(id) && !(pressed[c.id] ?? []).includes(id));
    if (add.length) press[c.id] = add;
  }
  const withPress = (o: Outcome): Outcome => (Object.keys(press).length ? { ...o, press } : o);
  const partials = eligible.flatMap((c) => { const have = pool(c); return (c.partial ?? []).filter((x) => x.has.every((id) => have.has(id)) && x.has.some((id) => provided.has(id))); });
  if (partials[0]) return withPress(line('nearMiss', partials[0].reply, partials[0].feedback ?? FEEDBACK.accepted(partials[0].has.map(nameOf))));
  const accepted = eligible.flatMap((c) => [...pool(c)].filter((id) => reqIds(c).has(id) && provided.has(id)));
  if (accepted.length) return withPress(line('nearMiss', pick(lines.nearMiss), FEEDBACK.accepted([...new Set(accepted)].map(nameOf))));
  // 이미 털어놓은 일의 근거를 다시 내밀었다
  if (CHALLENGES.some((c) => c.person === person && done.has(c.id) && c.requires.some((set) => set.some((id) => provided.has(id))))) return line('repeat', pick(lines.repeat), FEEDBACK.repeat);
  return line('nearMiss', pick(lines.nearMiss), FEEDBACK.unrelatedRough);
}

/**
 * 응답 결정 규칙
 * 1. 지적이 하나라도 있으면 지적만 처리한다. 여러 지적 중 성공하는 첫 번째를 쓴다.
 *    다른 질문이 함께 있었으면 "하나씩 물어 달라"는 말을 덧붙인다.
 * 2. 질문만 있으면 나온 순서대로 최대 3개 주제에 답한다. 같은 주제는 한 번만 답한다.
 *    이미 답한 주제는 again 버전으로 답한다. 4개 이상이면 나머지는 다시 물어 달라고 한다.
 * 3. 일부 질문만 답할 수 없으면, 답한 뒤 "나머지는 모른다"를 덧붙인다. 전부 모르면 unknown 대사.
 * 4. "처음부터 다시 말해 달라"는 요청에는 가장 최근 공식 진술 원문을 그대로 들려준다.
 * 5. 사건과 무관한 말만 있으면 offtopic, 해석할 수 없으면 clarify 대사.
 * recent: 이 사람이 최근에 한 말. 같은 대사를 연달아 고르지 않는 데 쓴다.
 */
export function resolve(person: PersonId, it: Interpretation, attached: string[], owned: Set<string>, done: Set<string>, recent: string[] = [], pressed: Pressed = {}, lastFacts: string[] = [], said = ''): Outcome {
  recentLines = recent;
  const lines = linesOf(person, owned);
  const segs = it.segments.length ? it.segments : [{ kind: 'clarify' as const, targetClaimIds: [], citedEvidenceIds: [], factIds: [] }];
  const challenges = segs.filter((s) => s.kind === 'challenge');
  const others = segs.filter((s) => s.kind !== 'challenge');
  const scattered = citedSources(person, segs, owned).size > MAX_CITED;

  // 근거를 잔뜩 늘어놓은 지적은 판정하지 않는다
  if (scattered && challenges.length) return line('nearMiss', pick(lines.scatter), FEEDBACK.scatter);
  // 자료만 언급한 질문은 지적이 아니다. 어떤 말이 거짓인지 짚어야 한다 (질문으로만 답한다)

  if (challenges.length) {
    let best: Outcome | null = null;
    for (const s of challenges) {
      const o = s.rough ? resolveRough(person, s, owned, done, pressed) : resolveChallenge(person, s, attached, owned, done, pressed);
      if (o.kind === 'success') { best = o; break; }
      if (!best || (best.kind !== 'repeat' && o.kind === 'repeat')) best = o;
    }
    // 지적이 통하지 않았는데 같은 말에 처음 묻는 질문이 있으면, 질문을 버리지 않고 답한다.
    // ("다툰 적 있나요? 직원이 언성을 들었다던데요": 아직 듣지 않은 부인을 먼저 받는다) 이번에 든 근거는 그 논점에 남겨 둔다
    if (best!.kind !== 'success') {
      const allowedNow = allowedFacts(person, owned);
      const asksNew = others.some((s) => s.kind === 'question' && s.factIds.some((id) => !owned.has(id) && allowedNow.some((f) => f.id === id)));
      if (asksNew) {
        const answered = resolve(person, { ...it, segments: others }, attached, owned, done, recent, pressed, lastFacts, said);
        return best!.press ? { ...answered, press: best!.press } : answered;
      }
    }
    const extra = challenges.length > 1 || others.some((s) => s.kind === 'question' || s.kind === 'restate');
    if (extra) best!.parts.push({ text: pick(lines.oneAtATime) });
    return best!;
  }

  const allowed = allowedFacts(person, owned);
  const facts: Fact[] = [];
  let unknownSegs = 0, restate = false, clarify = false, substantive = false, casual = false, detail = false;
  /** 정해 둔 답이 있지만 물은 것에 바로 답하지 않아 건너뛴 질문의 주제 (무엇을 아직 못 들었는지 알려 준다) */
  const skipped: Fact[] = [];
  for (const s of others) {
    if (s.kind === 'offtopic') continue;
    substantive = true;
    if (s.kind === 'casual') { casual = true; continue; }
    if (s.kind === 'restate') {
      // "~냐고요" 같은 재촉을 AI가 "처음부터 다시"로 읽어도, 그렇게 말하지 않았으면 직전 질문을 다시 물은 것으로 본다
      if (said && !EXPLICIT_RESTATE.test(said)) {
        // 처음 묻는 말을 "다시 말해 달라"로 읽은 경우: 앞서 한 답이 없으면 되풀이할 것도 없다. 함께 고른 주제가 있으면 그것에 답한다
        if (!lastFacts.length) { if (!others.some((x) => x.kind === 'question' && x.factIds.length)) unknownSegs++; continue; }
        facts.push(...lastFacts.map((id) => allowed.find((f) => f.id === id)).filter((f): f is Fact => !!f)); continue;
      }
      restate = true; continue;
    }
    if (s.kind === 'detail') {
      // AI가 "정해 둔 세부 답이 없다"고 봤어도, 말에 세부 주제의 낱말이 있으면 그 답을 쓴다 (화장실 시각 등)
      const hit = said ? allowed.filter((f) => !s.factIds.includes(f.id) && f.keywords.some((k) => k.length >= 2 && said.includes(k))).sort((a, b) => b.keywords.filter((k) => said.includes(k)).length - a.keywords.filter((k) => said.includes(k)).length)[0] : undefined;
      if (hit) { if (!facts.includes(hit)) facts.push(hit); continue; }
      detail = true; continue;
    }
    if (s.kind === 'clarify') { clarify = true; continue; }
    // 한 의미 단위에는 답 하나만 한다 (AI가 주제를 두 개 붙이면 이미 한 말을 되풀이하거나 엉뚱한 답이 섞였다)
    // 주제만 비슷하고 물은 것에 답하지 않는 답은 쓰지 않는다 (인물이 직접 답을 쓴다). 자료·진술을 넘기는 답만은 진행에 필요하므로 쓴다.
    // 진술서·기록부에 남는 답을 아직 듣지 않았고 말에 그 주제어가 있으면 그 답을 쓴다 (같은 내용을 자유 대사로 말하고 기록하지 않는 일을 막는다)
    const cands = s.factIds.map((id) => allowed.find((f) => f.id === id)).filter((f): f is Fact => !!f)
      // 한 말에 여러 질문을 했으면, 아직 듣지 않은 기록되는 답은 물은 것에 정확히 맞지 않아도 답한다 ("하나씩 물어 달라"로 넘기지 않게)
      .filter((f) => s.direct !== false || !!f.reveals?.length || (!owned.has(f.id) && counts(f) && (topicHit(f, said) || others.filter((x) => x.kind === 'question').length > 1)));
    // 한 문장에 두 가지를 물었으면("어디 세웠고, 그 뒤로 움직였어요?") 새로 묻는 주제는 모두 답한다. 이미 한 답은 되풀이하지 않는다
    const fresh = cands.filter((f, i) => !owned.has(f.id) && cands.findIndex((x) => (x.topicKey ?? x.id) === (f.topicKey ?? f.id)) === i);
    const fs = fresh.length ? fresh.slice(0, 2) : cands.slice(0, 1);
    if (!fs.length) {
      unknownSegs++;
      const near = s.factIds.map((id) => allowed.find((f) => f.id === id)).find((f): f is Fact => !!f);
      if (near) skipped.push(near);
    }
    fs.forEach((f) => { if (!facts.includes(f)) facts.push(f); });
  }

  // 방금 답한 주제를 바로 또 물으면 같은 말을 되풀이하지 않는다 (재촉에는 더 할 말이 없다고 한다)
  const fresh = facts.filter((f) => !lastFacts.includes(f.id));
  if (facts.length && !fresh.length && !restate) return { ...line('fact', pick(lines.noMore)), facts: facts.map((f) => f.id) };
  facts.splice(0, facts.length, ...fresh);
  if (!facts.length && !restate) {
    if (!substantive) return line('offtopic', pick(lines.offtopic));
    // 정해 둔 답이 없는 세부를 캐물으면 지어내지 않고 모른다고 한다
    if (detail && !unknownSegs) return { ...line('unknown', pick(lines.noDetail)), free: true };
    // 사소한 질문만 있으면 AI가 인물로서 답한다. 답을 못 만들면 화면에서 모른다는 대사로 바꾼다
    if (casual && !unknownSegs) return { kind: 'casual', parts: [], reveals: [], basis: [], casual: true };
    if (clarify && !unknownSegs) return line('clarify', pick(lines.clarify));
    return { ...line('unknown', pick(lines.unknown)), free: true };
  }

  const out: Outcome = { kind: 'fact', parts: [], reveals: [], basis: [] };
  if (restate) {
    // 서면 진술서를 읽지 않는다. 지금까지 그 사람에게 들은 답을 그 사람 말투로 순서대로 다시 말한다.
    // 아직 한 말이 없으면 "방금 말씀드린 게 다"라고 하지 않는다 (듣지 않은 대화가 있었던 것처럼 보이지 않게)
    const told = toldSoFar(person, owned);
    if (told.length) out.parts.push({ text: `${pick(lines.restate)} ${told.join(' ')}` });
    else if (!facts.length) return { ...line('unknown', pick(lines.unknown)), free: true };
  }
  for (const f of facts.slice(0, MAX_ANSWERS)) {
    const st = f.reveals?.find((id) => statementById.has(id) && !owned.has(id));
    if (st) {
      out.parts.push({ text: sayOf(st), source: st });
      out.reveals.push(...f.reveals!, f.id);
      out.kind = 'success';
      out.record = st;
      continue;
    }
    // 자료만 내주는 답: 답을 하고 자료를 넘긴다 (예: 권태석이 근무일지를 확인하라고 한다)
    if (f.reveals) out.reveals.push(...f.reveals.filter((id) => !owned.has(id)));
    const told = owned.has(f.id);
    // 같은 내용이라도 말할 때마다 조금씩 다르게 (방금 한 말은 피한다)
    const said = pick([f.answer, ...(f.alt ?? [])]);
    const text = told ? f.again ?? pick(lines.again) + said : said;
    out.parts.push({ text: f.record ? asClue(f.id, text) : text, source: f.record ? f.id : undefined });
    out.reveals.push(f.id);
    // 진술서 칸이 처음 채워지면 원 진술이 생긴다 (이때부터 그 진술을 지적할 수 있다)
    const base = formOf.get(f.id);
    if (base && !owned.has(base) && !out.reveals.includes(base)) out.reveals.push(base);
  }
  if (facts.length > MAX_ANSWERS) out.parts.push({ text: pick(lines.tooMany) });
  if (detail) out.parts.push({ text: pick(lines.noDetail) });
  out.facts = facts.slice(0, MAX_ANSWERS).map((f) => f.id);
  if (casual) out.casual = true;
  if (unknownSegs > 0) {
    // 모르는 일이 아니라 답을 건너뛴 질문뿐이면 "모른다"고 하지 않고, 따로 물어 달라고 하며 무엇이 남았는지 수첩에 적는다
    if (skipped.length === unknownSegs) {
      out.parts.push({ text: pick(lines.oneAtATime) });
      out.feedback = FEEDBACK.unanswered(skipped.map((f) => f.topic.split(',')[0].trim()));
    } else out.parts.push({ text: pick(lines.unknownPart) });
  }
  return out;
}

/**
 * 끝난 지적: 판정으로 끝난 것과, 그 지적이 끌어내는 진술을 이미 받은 것 (질문의 답으로 정정된 경우).
 * 같은 진술을 다시 끌어내는 지적이 또 "통해서" 같은 정정이 두 번 나오지 않게 한다.
 */
export function closedChallenges(s: { done: string[]; owned: string[] }, extra: string[] = []): Set<string> {
  const owned = new Set([...s.owned, ...extra]);
  return new Set([...s.done, ...CHALLENGES.filter((c) => c.reveals.some((id) => statementById.has(id) && owned.has(id))).map((c) => c.id)]);
}

export type Verdict = 'correct' | 'partial' | 'wrong';

/** 서술형 채점의 재료: 문항마다 담은 요점과 채점관의 한 줄 */
export interface PointMarks {
  /** 문항 ID → 핵심을 담은 요점 */
  matched: Record<string, string[]>;
  /** 문항 ID → 방향은 맞지만 흐릿한 요점 (세모) */
  partial?: Record<string, string[]>;
  comments: Record<string, string>;
  /** 낱말로 채점했다 (AI에 닿지 못함) */
  local?: boolean;
}

const squash = (t: string) => t.replace(/\s+/g, '');

/** 낱말 채점: 요점의 낱말이 하나라도 있으면 그 요점을 담은 것으로 본다 (AI가 없을 때) */
export function localMarks(answers: Record<string, string>): PointMarks {
  const matched: Record<string, string[]> = {};
  const comments: Record<string, string> = {};
  for (const q of REPORT_QUESTIONS) {
    const a = squash(answers[q.id] ?? '');
    matched[q.id] = a ? q.points.filter((p) => p.keywords.some((k) => a.includes(squash(k)))).map((p) => p.id) : [];
    comments[q.id] = a ? '' : '답을 쓰지 않았다.';
  }
  return { matched, comments, local: true };
}

/** 요점으로 가른다: 필요한 만큼 핵심을 담으면 정답, 하나라도 담거나 흐릿하게라도 짚으면 세모(부분 정답), 아니면 오답 */
export function verdictOf(qid: string, matched: string[], partial: string[] = []): Verdict {
  const q = REPORT_QUESTIONS.find((x) => x.id === qid)!;
  const n = q.points.filter((p) => matched.includes(p.id)).length;
  const half = q.points.filter((p) => partial.includes(p.id)).length;
  return n >= q.need ? 'correct' : n > 0 || half > 0 ? 'partial' : 'wrong';
}

/**
 * 사건 재구성 채점. 모든 문항을 한 번에 채점한다.
 * 범인이 틀리면 오인(wrong). 범인을 맞히고 서술형을 모두 맞히면 해결(perfect),
 * 절반 이상(세모는 반)이면 확인(solved), 그 아래면 미해결(insufficient).
 */
export function grade(d: ReportDraft, marks: PointMarks = localMarks(d.answers)): ReportResult {
  // 자살·사고사를 고르면 결론부터 틀렸으므로 서술형은 채점하지 않는다
  if (isNoCulprit(d.culprit)) {
    const qs = ALT_QUESTIONS[d.culprit];
    return {
      grade: 'wrong', culpritOk: false,
      correct: Object.fromEntries(qs.map((q) => [q.id, false])),
      verdicts: Object.fromEntries(qs.map((q) => [q.id, 'wrong' as const])),
      comments: Object.fromEntries(qs.map((q) => [q.id, '결론이 틀려 채점하지 않았다.'])),
    };
  }
  const culpritOk = d.culprit === CULPRIT;
  const verdicts = Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, verdictOf(q.id, marks.matched[q.id] ?? [], marks.partial?.[q.id] ?? [])])) as Record<string, Verdict>;
  const correct = Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, verdicts[q.id] === 'correct'])) as Record<string, boolean>;
  const score = REPORT_QUESTIONS.reduce((n, q) => n + (verdicts[q.id] === 'correct' ? 1 : verdicts[q.id] === 'partial' ? 0.5 : 0), 0) / REPORT_QUESTIONS.length;
  const g = !culpritOk ? 'wrong' : score === 1 ? 'perfect' : score >= 0.5 ? 'solved' : 'insufficient';
  // 정답 문항에는 지적을 붙이지 않는다 (정답인데 '빠졌다'는 말이 붙으면 헷갈린다. 모범 답은 따로 보인다)
  const comments = Object.fromEntries(Object.entries(marks.comments).map(([id, c]) => [id, verdicts[id] === 'correct' ? '' : c]));
  return { grade: g, culpritOk, correct, verdicts, comments, ...(marks.local ? { local: true } : {}) };
}
