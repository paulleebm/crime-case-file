import { callAI, Rejected } from '../ai/transport';
import type { ColdState } from './engine';
import { buildOrderPrompt, sanitizeOrder, wordOrder, type Order } from './orderParse';

export { MAX_ORDER_INPUT } from './orderParse';

// 수사 지시 해석. AI(작업 coldOrder)가 먼저 해석하고, 닿지 않으면 낱말로 고른다.

export async function interpretOrder(text: string, s: ColdState, history: { who: string; text: string }[]): Promise<Order> {
  try {
    let parsed: Omit<Order, 'via'> | null = null;
    await callAI('coldOrder', buildOrderPrompt(text, s, history), {
      budgetMs: 30000,
      parse: (raw) => {
        try { parsed = sanitizeOrder(JSON.parse(raw)); } catch { throw new Rejected('json', '\n[고칠 점] 지정된 JSON 형식으로만 답한다.'); }
      },
    });
    if (parsed) return { ...(parsed as Omit<Order, 'via'>), via: 'ai' };
  } catch { /* AI가 닿지 않으면 낱말로 */ }
  return { ...wordOrder(text), via: 'words' };
}
