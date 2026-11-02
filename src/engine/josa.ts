/** 받침에 따라 조사를 고른다. 낱말 끝의 「」·괄호·따옴표는 건너뛰고 마지막 한글(또는 숫자)을 본다 */
type Pair = '이/가' | '은/는' | '을/를' | '과/와' | '으로/로';

/** 숫자를 한국어로 읽을 때 받침이 있는지 (0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔, 10 십) */
const DIGIT_FINAL: Record<string, boolean> = { '0': true, '1': true, '2': false, '3': true, '4': false, '5': false, '6': true, '7': true, '8': true, '9': false };

/** 마지막 글자의 받침: true 있음, false 없음, 'rieul' ㄹ받침, null 판단 불가 */
function finalOf(word: string): boolean | 'rieul' | null {
  const ch = word.replace(/[\s」』)\]"'”’.,!?…]+$/u, '').slice(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0) - 0xac00;
  if (code >= 0 && code < 11172) {
    const jong = code % 28;
    return jong === 0 ? false : jong === 8 ? 'rieul' : true;
  }
  if (ch in DIGIT_FINAL) return ch === '1' || ch === '7' || ch === '8' ? 'rieul' : DIGIT_FINAL[ch];
  return null;
}

/** 낱말 뒤에 알맞은 조사를 붙인다. 판단할 수 없으면 '이(가)'처럼 둘 다 적는다 */
export function josa(word: string, pair: Pair): string {
  const [withFinal, without] = pair.split('/');
  const f = finalOf(word);
  if (f === null) return `${word}${withFinal}(${without})`;
  if (pair === '으로/로') return word + (f === true ? withFinal : without);
  return word + (f ? withFinal : without);
}
