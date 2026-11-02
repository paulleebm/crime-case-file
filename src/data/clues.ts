// 근거 문장 표기법: 본문 안에 ⟦ID|문장⟧ 으로 적는다.
// ID는 "인용 대상 ID.번호" 형식이다. 예) A-01.3 → 진술 A-01의 3번째 근거 문장, E-04.1 → 자료 E-04의 근거 줄.
// 수집하면 엔진은 점 앞의 ID(A-01, E-04)로 판정한다.

const CLUE_SRC = /⟦([^|⟧]+)\|([^⟧]+)⟧/.source;
/** 매번 새 정규식을 만든다 (전역 정규식의 lastIndex 공유 문제 방지) */
export const clueRe = () => new RegExp(CLUE_SRC, 'g');
export const hasClue = (text: string) => new RegExp(CLUE_SRC).test(text);

export function clueRef(clueId: string): string {
  return clueId.replace(/\.\d+$/, '');
}

/** 표기를 걷어 낸 평문 (AI 프롬프트, 짧은 미리보기용) */
export function plain(text: string): string {
  return text.replace(clueRe(), '$2');
}

export type Segment = { text: string } | { clue: string; text: string };

export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(clueRe())) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    out.push({ clue: m[1], text: m[2] });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
