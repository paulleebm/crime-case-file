import { REPORT_QUESTIONS } from '../data/case';
import type { ReportQuestion } from '../data/types';
import { localMarks, type PointMarks } from '../engine/logic';
import { noBreak } from './prompts';
import { callAI } from './transport';

// 사건 재구성 서술형 채점. 요점마다 담음·애매함·없음만 정한다 (정답·세모·오답은 엔진이 요점으로 가른다).
// AI 채점관이 뜻으로 판단한다. AI에 닿지 못하면 요점의 낱말로 본다.

/** 서술형 답 길이 상한 */
export const MAX_ANSWER = 600;

export function buildGradePrompt(answers: Record<string, string>, questions: ReportQuestion[] = REPORT_QUESTIONS): string {
  return questions.map((q, i) => [
    `[문항 ${i + 1}] id=${q.id} (${q.w}) ${q.q}`,
    '[요점]',
    ...q.points.map((p) => `- ${p.id}: ${p.text}`),
    '<답>',
    noBreak((answers[q.id] ?? '').slice(0, MAX_ANSWER)) || '(비어 있음)',
    '</답>',
  ].join('\n')).join('\n\n');
}

/** AI로 채점한다. 실패하면 낱말 채점을 돌려준다 (채점이 막혀 결론을 못 내는 일이 없게) */
export async function gradeAnswers(answers: Record<string, string>): Promise<PointMarks> {
  const fallback = localMarks(answers);
  try {
    const raw = await callAI('grade', buildGradePrompt(answers), { attemptMs: 20000, hedgeMs: 8000, budgetMs: 40000, parse: JSON.parse });
    const o = JSON.parse(raw) as { results?: { id?: unknown; points?: unknown; comment?: unknown }[] };
    const matched: Record<string, string[]> = {};
    const comments: Record<string, string> = {};
    const partial: Record<string, string[]> = {};
    for (const q of REPORT_QUESTIONS) {
      const r = o.results?.find((x) => x.id === q.id);
      // 형식이 다른 응답(예전 채점 형식 등)이면 낱말 채점으로 (모두 오답 처리하지 않게)
      if (!r || !Array.isArray(r.points)) return fallback;
      const pts = Array.isArray(r.points) ? r.points as { id?: unknown; status?: unknown }[] : [];
      const status = (pid: string) => pts.find((x) => x.id === pid)?.status;
      const blank = !(answers[q.id] ?? '').trim();
      // 빈 답은 AI가 무엇이라 하든 요점이 없다
      matched[q.id] = blank ? [] : q.points.map((p) => p.id).filter((id) => status(id) === 'yes');
      partial[q.id] = blank ? [] : q.points.map((p) => p.id).filter((id) => status(id) === 'partial');
      comments[q.id] = blank ? '답을 쓰지 않았다.' : typeof r.comment === 'string' ? r.comment.slice(0, 160) : '';
    }
    return { matched, partial, comments };
  } catch (e) {
    if (import.meta.env?.DEV) console.warn('[채점 실패, 낱말 채점으로]', e);
    return fallback;
  }
}
