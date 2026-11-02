import { callAI, Rejected } from '../ai/transport';
import type { ColdState } from './engine';
import { buildTalkPrompt, sanitizeTalk, type TalkTurn } from './talkParse';

export { MAX_TALK_INPUT } from './talkParse';

// 조사실 자유 대화. AI(작업 coldTalk)가 형사의 말을 주제·내민 자료로 옮기고 인물의 말투로 답을 다시 쓴다.
// 닿지 않으면 none을 돌려주고, 화면은 질문 버튼과 자료 내밀기(예비)를 쓰라고 알린다.

export async function interpretTalk(text: string, s: ColdState): Promise<TalkTurn> {
  try {
    let parsed: Omit<TalkTurn, 'via'> | null = null;
    await callAI('coldTalk', buildTalkPrompt(text, s), {
      budgetMs: 30000,
      parse: (raw) => {
        try { parsed = sanitizeTalk(JSON.parse(raw), s); } catch { throw new Rejected('json', '\n[고칠 점] 지정된 JSON 형식으로만 답한다.'); }
      },
    });
    if (parsed) return { ...(parsed as Omit<TalkTurn, 'via'>), via: 'ai' };
  } catch { /* 아래 */ }
  return { kind: 'unknown', topic: '', evidence: [], reply: '', via: 'none' };
}
