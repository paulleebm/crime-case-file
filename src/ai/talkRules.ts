import type { PersonId } from '../data/types';
import type { TalkInput, TalkResult } from './talk';

// 대사 검사에서 사건마다 다른 부분 (2026-10-21). 검사·판정 처리는 talk.ts가 하고, 무엇을 숨기고 무엇이 인정인지는 사건 규칙이 알려 준다.
// 새 사건은 src/data/<사건>TalkRules.ts에 이 형식을 채우고 src/data/talkRules.ts에서 고른다. 단계 ID는 인물 설정집(dossiers)의 stages와 같다.

/** 숨긴 사실 항목 (판정 AI가 답이 건드렸는지 표시한다). denyIsCover: 이 사실을 부정하는 것이 그 단계의 거짓말 자체라 누설이 아니다 */
export interface HiddenFact { id: string; stage: string; text: string; denyIsCover?: boolean }

export interface TalkRules {
  /** [추궁 판정]: 이번 말·이번에 내민 자료·앞서 내민 자료를 대조해 단계마다 인정하라/버티라는 줄 ("- C-R02: ... (admit에 C-R02)") */
  judgement(input: TalkInput): string[];
  /** 인정 문턱: 단계마다 형사가 가진·내민 근거로 인정이 성립하는가 (false면 인정을 받지 않는다. 적지 않은 단계는 AI 판단). plan: 해석을 AI에 맡기는 실험 */
  admitGate(input: TalkInput, plan: boolean): Record<string, boolean>;
  /** 아직 인정하지 않은 단계의 숨긴 낱말 (형사가 먼저 꺼내지 않았는데 대사에 나오면 누설) */
  stageWords: Record<string, string[]>;
  /** 숨긴 낱말이 새었을 때 다시 쓰며 지킬 것 */
  stageHold: Record<string, string>;
  /** 형사가 다른 말로 꺼낸 같은 사실 (말머리 → 같은 뜻의 말). 되받기를 누설로 보지 않게 한다 */
  sameAs: Record<string, RegExp>;
  /** 단계를 대사로만 거두는 꼴 (근거가 없으면 다시 받고, 있으면 인정으로 친다) */
  caves: Record<string, RegExp>;
  /** 문장 하나로는 알 수 없는 거둠 (형사의 말과 함께 봐야 하는 것) */
  extraCaves(input: TalkInput, sentences: string[]): string[];
  /** 인정한 뒤 다시 하면 안 되는 거짓말의 꼴 */
  retracted: Record<string, RegExp>;
  /** 거짓말의 다른 꼴 (판정의 시인 표시가 거짓말 그대로인지 볼 때만 쓴다) */
  coverExtra: Record<string, RegExp>;
  /** 단계를 거두는 말에 꼭 들어가는 말 (판정의 시인 표시가 그럴듯한지) */
  concedeSign: Record<string, RegExp>;
  /** 결정적 자료를 내밀었을 때 말로만 시인하고 admit을 비운 꼴 */
  implied: Record<string, { docs: string[]; re: RegExp }>;
  /** 그 밖에 엔진 판정과 함께 봐야 하는 말로만 시인 (더할 단계, 근거로 붙일 자료) */
  impliedExtra(input: TalkInput, r: TalkResult, sentences: string[], plan: boolean): { admit: string[]; basis: (doc: string) => boolean };
  /** 자백한 뒤 처음 입장으로 돌아가는 말 */
  denial: RegExp;
  /** 사실상 무너지는 말 (아무 단계도 인정하지 않았을 때) */
  confession: RegExp;
  /** 범행 자체를 털어놓는 말 (범행 단계를 인정하지 않았을 때) */
  crimeConfession: RegExp;
  /** 부정을 거두며 물러서는 말 ("닦은 적 없다고는 못 하겠습니다") */
  softCave: RegExp;
  /** 시인할 수 있는 문장의 낌새 (있을 때만 판정 AI를 부른다) */
  concedeHint: RegExp;
  /** 증인이 자기가 겪은 고정 사실을 뒤집는 말 */
  witnessFacts: Partial<Record<PersonId, RegExp[]>>;
  /** 문장 꼴로는 못 보는 증인 검사 */
  witnessExtra(input: TalkInput, reply: string): boolean;
  /** 사건에만 있는 그 밖의 검사 */
  extraProblem(input: TalkInput, reply: string): { why: string; fix: string } | null;
  /** 판정 AI에 주는 숨긴 사실 항목 (인물별) */
  hiddenFacts: Partial<Record<PersonId, HiddenFact[]>>;
  /** 판정 AI에 주는 거둔 거짓말 (단계별) */
  retractedClaims: Record<string, { id: string; text: string }[]>;
}
