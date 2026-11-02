import { PERSONS } from './case';
import type { Person, PersonId } from './types';

// 단계별 말투. 사실과 공개 조건은 그대로 두고, 인정한 범위에 따라 말의 태도만 바꾼다.
// 단계는 플레이어가 받아 낸 진술(인정 진술)로만 정한다. 반복 추궁·엉뚱한 질문으로는 바뀌지 않는다.

export interface ToneStage {
  /** 이 진술 가운데 하나라도 받아 냈으면 이 단계다 (없으면 처음 단계). 뒤에 적은 단계가 앞선다 */
  when?: string[];
  demeanor: string;
  voice: string;
  lines: Partial<Person['lines']>;
}

export const TONES: Record<PersonId, ToneStage[]> = {
  A: [
    { demeanor: '억울함 · 다급함', voice: PERSONS.A.voice, lines: {} },
    { when: ['C-R04'], demeanor: '안도 · 후회', voice: '가라앉은 존댓말, "~요" 체. 살인 의심은 풀렸지만 아버지에게 마지막으로 화낸 일을 후회한다.', lines: {} },
  ],
  B: [
    { demeanor: '긴장 · 차분', voice: PERSONS.B?.voice ?? '', lines: {} },
    { when: ['C-R04'], demeanor: '안도 · 슬픔', voice: '조용한 해요체. 사실대로 말한 것이 도움이 돼 다행이지만, 회장님이 그때 이미 다치셨다는 사실에 슬퍼한다.', lines: {} },
  ],
  C: [
    {
      demeanor: '공손 · 여유',
      voice: PERSONS.C.voice + ' 지금은 회의 알리바이와 카드 기록이 자신을 지켜 준다고 자신한다.',
      lines: {},
    },
    {
      when: ['C-R01', 'C-R02', 'C-R03'],
      demeanor: '경계 · 말이 짧아짐',
      voice: '굳은 존댓말, "~습니다" 체. 인정한 것은 다시 부인하지 않지만, 그것이 살인이나 문자 예약을 뜻하지는 않는다며 선을 긋는다. 말이 짧아진다.',
      lines: {
        nearMiss: ['인정할 것은 인정했습니다. 그것만으로 제가 했다고 하실 수는 없습니다.', '그건 다른 문제입니다.', '어떤 근거인지 제시해 주십시오.'],
        repeat: ['그건 이미 인정했습니다. 다시 물으셔도 같습니다.'],
      },
    },
    {
      when: ['C-R04'],
      demeanor: '체념',
      voice: '낮고 짧은 존댓말, "~습니다" 체. 모든 것을 자백했다. 변명을 되풀이하지 않고 자신의 행동과 선택만 말한다.',
      lines: {
        nearMiss: ['…더 숨길 것이 없습니다. 제가 했습니다.', '변명하지 않겠습니다.'],
        unknown: ['그건 정말 모릅니다. 아는 것은 다 말씀드렸습니다.'],
      },
    },
  ],
};

/** 지금 단계 (받아 낸 진술 기준) */
export function toneOf(person: PersonId, owned: Set<string>): ToneStage {
  const stages = TONES[person];
  return [...stages].reverse().find((s) => !s.when || s.when.some((id) => owned.has(id))) ?? stages[0];
}

/** 지금 단계의 대사 묶음 (단계에 없는 대사는 기본 대사) */
export function linesOf(person: PersonId, owned: Set<string>): Person['lines'] {
  return { ...PERSONS[person].lines, ...toneOf(person, owned).lines };
}
