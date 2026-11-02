import { FACTS, STATEMENTS } from '../data/case';
import { clueRe, clueRef, plain } from '../data/clues';
import { STATEMENT_FORMS, type FormPara } from '../data/statementForms';
import type { PersonId } from '../data/types';
import { evidenceById, factById, statementById } from './lookup';

// 지적은 문장 단위로 한다. "어떤 말이 거짓인지"를 정확히 짚어야 진술이 바뀐다.
// 지적할 수 있는 문장 = 플레이어가 지금 볼 수 있는 그 사람의 말
//   - 진술서에서 채워진 칸의 근거 문장 (A-01.3 등)
//   - 정정 진술의 근거 문장 (A-02.2 등)
//   - 기록되는 대화 답변 (A-F15 등, 답 하나가 주장 하나)

export interface Claim { id: string; text: string; struck: boolean }

/** 지금까지 정정된 문장 */
export function struckSet(owned: Set<string>): Set<string> {
  return new Set(STATEMENTS.filter((s) => owned.has(s.id)).flatMap((s) => s.strikes ?? []));
}

/**
 * 진술서 문단이 채워졌는가: 그 문단을 채우는 답을 실제로 들었을 때만.
 * (그 문단의 문장이 정정됐더라도, 플레이어가 받지 못한 말은 진술서나 이력에 생기지 않는다)
 */
export function paraShown(p: FormPara, owned: Set<string>, _struck?: Set<string>): boolean {
  return p.by.some((id) => owned.has(id));
}

/** 이 사람에게서 지금 지적할 수 있는 문장들 */
export function visibleClaims(person: PersonId, owned: Set<string>): Claim[] {
  const struck = struckSet(owned);
  const out: Claim[] = [];
  const form = STATEMENT_FORMS[person];
  if (owned.has(form.statementId)) {
    for (const sec of form.sections) for (const p of sec.paras) {
      if (!paraShown(p, owned, struck)) continue;
      for (const m of p.text.matchAll(clueRe())) out.push({ id: m[1], text: m[2], struck: struck.has(m[1]) });
    }
  }
  for (const s of STATEMENTS) {
    if (s.person !== person || s.initial || !owned.has(s.id)) continue;
    for (const m of s.text.matchAll(clueRe())) out.push({ id: m[1], text: m[2], struck: struck.has(m[1]) });
  }
  for (const f of FACTS) {
    if (f.person === person && f.record && owned.has(f.id)) out.push({ id: f.id, text: plain(f.answer), struck: false });
  }
  return out;
}

/** 진술서 문장(A-01.9) → 그 문단을 채운 답(A-F9). 진술서의 문장을 근거로 내밀면 그 답을 내민 것이다 */
const FORM_CLUE_FACTS = new Map<string, string[]>(
  Object.values(STATEMENT_FORMS).flatMap((f) => f.sections.flatMap((sec) => sec.paras.flatMap((p) => [...p.text.matchAll(clueRe())].map((m) => [m[1], p.by] as [string, string[]])))),
);
export const factsOfClue = (id: string, owned: Set<string>) => (FORM_CLUE_FACTS.get(id) ?? []).filter((f) => owned.has(f));

/** 근거로 든 ID를 판정 단위로: 근거 문장(A-03.1, E-05.1)은 그 진술·자료·답변 ID로 */
export function sourceId(id: string): string {
  const ref = clueRef(id);
  return ref !== id && (statementById.has(ref) || factById.has(ref) || evidenceById.has(ref)) ? ref : id;
}

/** 짚은 ID를 주장 ID로 맞춘다: 답변의 근거 문장(A-F2.1)은 답변 ID(A-F2)로 */
export function claimId(id: string): string {
  if (factById.has(id) || statementById.has(id)) return id;
  const ref = clueRef(id);
  return factById.has(ref) ? ref : id;
}
