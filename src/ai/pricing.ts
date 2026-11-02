import type { AiUsage } from './transport';

/** 1M 토큰당 USD (2026-10-17 요금표, 캐시 쓰기는 5분 기준 1.25배) */
export const PRICE: Record<string, { in: number; read: number; write: number; out: number }> = {
  'claude-haiku-5-5': { in: 0.1, read: 0.01, write: 0.125, out: 0.5 },
  'claude-sonnet-5-5': { in: 2, read: 0.2, write: 2.5, out: 10 },
  'claude-opus-5-5': { in: 4, read: 0.2, write: 5, out: 20 },
  'gpt-6-luna': { in: 0.1, read: 0.01, write: 0, out: 0.5 },
  'gpt-6.1-sol': { in: 2, read: 0.1, write: 0, out: 10 },
};

/** 운영자 화면에서 원화로 보여 줄 때 쓰는 대략의 환율 */
export const USD_KRW = 1400;

/** 요청 하나의 비용(USD). 단가를 모르는 모델이면 null */
export function usdOf(model: string | undefined, u: AiUsage): number | null {
  const p = model ? PRICE[model] : undefined;
  if (!p) return null;
  return (u.input * p.in + u.cacheRead * p.read + u.cacheWrite * p.write + u.output * p.out) / 1e6;
}
