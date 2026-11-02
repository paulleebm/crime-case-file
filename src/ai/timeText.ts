// 시각 글을 숫자로 읽는 공통 함수 (사건과 상관없다). talk.ts와 사건 규칙이 같이 쓴다

const NATIVE_HOUR: Record<string, number> = { 열두: 12, 열한: 11, 열: 10, 아홉: 9, 여덟: 8, 일곱: 7, 여섯: 6, 다섯: 5, 네: 4, 세: 3, 두: 2, 한: 1 };
const SINO: Record<string, number> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 };

/** 우리말로 쓴 시각을 숫자로 ("아홉 시 십 분" → "9시10분", "여덟 시 사십팔 분" → "8시48분") */
export function digitsOfTime(text: string): string {
  return text.replace(/\s/g, '')
    .replace(/(열두|열한|열|아홉|여덟|일곱|여섯|다섯|네|세|두|한)시/g, (_, h: string) => `${NATIVE_HOUR[h]}시`)
    // 한 자리 분은 "N시" 바로 뒤에서만 바꾼다 ("구분", "이분" 같은 낱말을 시각으로 읽지 않게)
    .replace(/(\d+시)([일이삼사오육칠팔구])분/g, (_, h: string, ones: string) => `${h}${SINO[ones]}분`)
    .replace(/([이삼사오육칠팔구]?)십([일이삼사오육칠팔구]?)분/g, (_, tens: string, ones: string) => `${(tens ? SINO[tens] : 1) * 10 + (ones ? SINO[ones] : 0)}분`)
    .replace(/(\d+시)반/g, '$130분');
}

/** 글 속의 시각들 ("8시 48분", "20:48", "여덟 시 사십팔 분" → "8:48"). 분이 없는 "9시"는 세지 않는다 */
export function timesIn(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of digitsOfTime(text).matchAll(/(\d{1,2})시(\d{1,2})분/g)) out.add(`${Number(m[1]) % 12 || 12}:${Number(m[2])}`);
  for (const m of text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)) out.add(`${Number(m[1]) % 12 || 12}:${Number(m[2])}`);
  return out;
}

/** 글 속의 "N분" ("8시 47분", "47분", "20:47"을 같은 것으로 본다) */
export const minute = (m: number) => new RegExp(`(^|[^\\d])${m}\\s*분|\\d{1,2}\\s*:\\s*${m}(?!\\d)`);
/** 우리말 시각을 숫자로 바꾼 글과 원래 글을 함께 (minute로 찾을 때 쓴다) */
export const said = (text: string) => digitsOfTime(text) + ' ' + text;
