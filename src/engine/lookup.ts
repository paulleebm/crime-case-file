import { CHALLENGES, EVIDENCE, FACTS, PERSONS, STATEMENTS } from '../data/case';
import type { Cond, Evidence, Fact, Statement } from '../data/types';
import { clueRef, plain } from '../data/clues';

export const evidenceById = new Map<string, Evidence>(EVIDENCE.map((e) => [e.id, e]));
export const statementById = new Map<string, Statement>(STATEMENTS.map((s) => [s.id, s]));
export const factById = new Map<string, Fact>(FACTS.map((f) => [f.id, f]));
export const challengeById = new Map(CHALLENGES.map((c) => [c.id, c]));

export function condMet(cond: Cond | undefined, owned: Set<string>): boolean {
  if (!cond) return true;
  if (cond.all && !cond.all.every((id) => owned.has(id))) return false;
  if (cond.any && cond.any.length && !cond.any.some((id) => owned.has(id))) return false;
  return true;
}

/** 화면과 AI에 쓰는 짧은 제목 */
export function titleOf(id: string): string {
  const e = evidenceById.get(id);
  if (e) return `${id} ${e.title}`;
  const s = statementById.get(id);
  if (s) return `${id} ${PERSONS[s.person].name} 진술`;
  const f = factById.get(id);
  if (f) return `${id} ${PERSONS[f.person].name} 답변`;
  // 근거 문장(E-13.4)은 그 자료·진술의 이름으로
  const ref = clueRef(id);
  return ref !== id && isCitable(ref) ? titleOf(ref) : id;
}

/** 번호 없이 보여 줄 이름 */
export function nameOf(id: string): string {
  return titleOf(id).replace(/^\S+\s/, '');
}

/** 원문 전체 (인용·AI 요약용) */
export function textOf(id: string): string {
  const e = evidenceById.get(id);
  if (e) return e.summary;
  const s = statementById.get(id);
  if (s) return plain(s.text);
  const f = factById.get(id);
  if (f) return plain(f.answer);
  return '';
}

/** 왼쪽 자료 목록·탭·알림에 쓰는 자료 이름 (사건 개요와 평면도 포함) */
export function docTitle(id: string): string {
  return id === 'BRIEF' ? '사건 개요' : id === 'GT-MAP' ? '집무실 평면도' : evidenceById.get(id)?.title ?? id;
}

/** 자료에 든 근거 문장 ID 전부 (자료를 통째로 근거로 내밀면 이 문장들을 모두 든 것으로 본다) */
const DOC_CLUES = new Map<string, string[]>(EVIDENCE.map((e) => [e.id, [...JSON.stringify(e.body).matchAll(/⟦([^|⟧]+)\|/g)].map((m) => m[1])]));
export const cluesOfDoc = (id: string): string[] => DOC_CLUES.get(id) ?? [];

export function isCitable(id: string): boolean {
  return evidenceById.has(id) || statementById.has(id) || factById.has(id);
}
