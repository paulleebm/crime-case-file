import type { Meta, StoryObj } from '@storybook/react-vite';
import { CULPRIT, REPORT_QUESTIONS } from '../data/case';
import { STATEMENT_FORMS } from '../data/statementForms';
import type { GameState } from '../engine/state';
import { BriefingDoc } from '../ui/BriefingDoc';
import { FormView } from '../ui/FormView';
import { HintButton } from '../ui/HintButton';
import { FloorPlan, MapView } from '../ui/MapView';
import { ReportSheet } from '../ui/Report';

const meta = { title: '화면/조각' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const 사건_개요: Story = { render: () => <BriefingDoc /> };

export const 평면도: Story = { render: () => <div style={{ width: 900 }}><FloorPlan /></div> };

export const 평면도_말: Story = {
  parameters: {
    game: (s: GameState): GameState => ({
      ...s,
      pawns: {
        time: 23 * 60 + 10,
        keys: {
          V: [{ t: 0, x: 600, y: 50 }],
          A: [{ t: 0, x: 140, y: 220 }],
          B: [{ t: 0, x: 860, y: 260 }],
          C: [{ t: 0, x: 860, y: 400 }],
        },
      },
    }),
  },
  render: () => <div style={{ height: 820 }}><MapView /></div>,
};

const filled = (s: GameState): GameState => ({
  ...s,
  owned: [...s.owned, 'B-01', ...STATEMENT_FORMS.B.sections.flatMap((x) => x.paras.map((pp) => pp.by[0])), 'B-02'],
});

export const 빈_진술서: Story = { render: () => <div style={{ width: 760 }}><FormView person="B" /></div> };
export const 채운_진술서와_정정: Story = { parameters: { game: filled }, render: () => <div style={{ width: 760 }}><FormView person="B" /></div> };

export const 힌트_버튼: Story = {
  parameters: { game: (s: GameState): GameState => ({ ...s, owned: [...s.owned, 'A-01', 'B-01', 'C-01', 'B-F5'] }) },
  render: () => <div style={{ display: 'flex', justifyContent: 'flex-end', width: 420, height: 320 }}><HintButton /></div>,
};

const ALL_RIGHT = Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, q.model]));
export const 보고서_채점: Story = {
  render: () => (
    <div style={{ width: 720 }}>
      <ReportSheet
        draft={{ culprit: CULPRIT, answers: { ...ALL_RIGHT, how: '약을 꺼내 줘 스스로 먹게 했다' } }}
        graded={{ grade: 'solved', culpritOk: true, correct: { ...Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, true])), how: false }, verdicts: { ...Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, 'correct' as const])), how: 'partial' }, comments: { how: '술에 넣었다는 점은 맞지만, 범인이 직접 넣었다는 점이 빠졌다.' } }}
      />
    </div>
  ),
};
