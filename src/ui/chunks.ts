// 긴 답을 사람처럼 여러 번에 나눠 보낸다 (2026-10-15 사용자 결정).
// 짧은 답은 한 번에, 긴 답은 두 문장 안팎씩 묶어 2~3개 말풍선으로 나눈다. 말풍선 사이 간격은 1초 남짓이다.
// 너무 짧은 문장을 하나씩 보내지 않는다: 말풍선은 대략 두 문장, 글자 수로 50~110자를 기준으로 묶는다.

/** 이보다 짧으면 나누지 않는다 */
const SPLIT_FROM = 110;
/** 말풍선 하나가 이만큼 차면 (문장 수와 관계없이) 다음 말풍선으로 넘긴다 */
const FULL = 110;
/** 두 문장을 묶었어도 이보다 짧으면 한 문장 더 붙인다 */
const MIN_CHUNK = 50;
const MAX_CHUNKS = 3;

/** 문장 끝: 마침표·물음표·느낌표·말줄임 뒤의 공백이나 줄바꿈 */
const sentences = (t: string) => t.split(/(?<=[.?!…])\s+|\n+/).map((x) => x.trim()).filter(Boolean);

export function splitReply(text: string): string[] {
  const t = text.trim();
  if (t.length < SPLIT_FROM) return [t];
  const out: { text: string; n: number }[] = [];
  for (const s of sentences(t)) {
    const cur = out[out.length - 1];
    // 지금 말풍선이 두 문장 이상이고 충분히 길거나, 이미 꽉 찼으면 새 말풍선을 연다
    const close = !cur || (cur.n >= 2 && cur.text.length >= MIN_CHUNK) || cur.text.length + s.length > FULL + 30 && cur.text.length >= MIN_CHUNK;
    if (close) out.push({ text: s, n: 1 });
    else { cur.text = `${cur.text} ${s}`; cur.n++; }
  }
  const parts = out.map((x) => x.text);
  // 마지막 말풍선이 한 문장짜리로 짧으면 앞에 붙인다
  if (parts.length > 1 && parts[parts.length - 1].length < MIN_CHUNK * 0.7) parts.splice(-2, 2, `${parts[parts.length - 2]} ${parts[parts.length - 1]}`);
  // 너무 많으면 뒤쪽을 합친다
  while (parts.length > MAX_CHUNKS) parts.splice(-2, 2, `${parts[parts.length - 2]} ${parts[parts.length - 1]}`);
  return parts;
}

/** 다음 말풍선까지 기다리는 시간 (1초 남짓, 조금씩 다르게) */
export const chunkGap = () => 850 + Math.random() * 350;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
