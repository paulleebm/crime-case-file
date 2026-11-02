import { STATEMENTS } from '../data/case';
import { clueRe } from '../data/clues';
import { STATEMENT_FORMS } from '../data/statementForms';
import type { PersonId } from '../data/types';

// 진술서에 정정 진술을 어디에 놓을지 정한다.
// 정정 진술은 그것이 바꾼 문장이 있는 항목에 놓인다 (정정의 정정이면 처음 바뀐 문장의 항목까지 거슬러 올라간다).
// 바꾼 문장 없이 덧붙인 변명은 그것이 고쳐 말한 진술의 항목에 놓인다.
// 그래서 진술서를 읽으면 항목마다 지금의 진술을 바로 볼 수 있고, 서로 다른 논점의 정정은 서로를 가리지 않는다.

const cluesOf = (text: string) => [...text.matchAll(clueRe())].map((m) => m[1]);

/** 정정 진술 ID → 진술서 항목 번호. 어느 항목에도 닿지 않으면 -1 (끝의 "추가 진술"에 둔다) */
export function revisionSections(person: PersonId): Map<string, number> {
  const clueSec = new Map<string, number>();
  STATEMENT_FORMS[person].sections.forEach((sec, i) => sec.paras.forEach((p) => cluesOf(p.text).forEach((id) => clueSec.set(id, i))));
  const out = new Map<string, number>();
  for (const s of STATEMENTS) {
    if (s.person !== person || s.initial) continue;
    // 정정한 문장이 없으면(덧붙인 변명) 그것이 고쳐 말한 진술의 항목에 둔다
    const sec = (s.strikes ?? []).map((id) => clueSec.get(id)).find((i): i is number => i !== undefined) ?? (s.revises ? out.get(s.revises) : undefined) ?? -1;
    out.set(s.id, sec);
    if (sec >= 0) cluesOf(s.text).forEach((id) => clueSec.set(id, sec));
  }
  return out;
}

/** 이 글에 아직 정정되지 않은 근거 문장이 있는가 (모두 정정됐으면 지금의 진술에서는 접는다) */
export function hasLiveClue(text: string, struck: Set<string>): boolean {
  return cluesOf(text).some((id) => !struck.has(id));
}

/** 이 글에서 정정된 근거 문장 수 */
export function struckCount(text: string, struck: Set<string>): number {
  return cluesOf(text).filter((id) => struck.has(id)).length;
}

export const hasClues = (text: string) => cluesOf(text).length > 0;
