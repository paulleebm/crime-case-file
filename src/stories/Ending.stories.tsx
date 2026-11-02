import type { Meta, StoryObj } from '@storybook/react-vite';
import { CULPRIT, REPORT_QUESTIONS } from '../data/case';
import { grade } from '../engine/logic';
import type { GameState, ReportDraft } from '../engine/state';
import { Afterword, Epilogue, Result } from '../ui/Result';

// 사건을 푼 뒤의 화면: 수사 결과(엔딩), 진상 해설, 사건 이후.

const meta = { title: '화면/결말' } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const ALL_RIGHT = Object.fromEntries(REPORT_QUESTIONS.map((q) => [q.id, q.model]));
/** 진상까지 받아 낸 상태 (사건 이후의 덧붙는 문장이 모두 보인다) */
const CONFESSED = ['A-01', 'A-02', 'B-01', 'B-03', 'B-04', 'C-01', 'C-02', 'C-04', 'C-07', 'C-08', 'C-09', 'C-05'];

const ended = (draft: ReportDraft, screen: GameState['screen'], owned = CONFESSED) => (s: GameState): GameState => ({
  ...s,
  screen,
  owned: [...new Set([...s.owned, ...owned])],
  report: draft,
  result: grade(draft),
});

const perfect: ReportDraft = { culprit: CULPRIT, answers: ALL_RIGHT };
const insufficient: ReportDraft = { culprit: CULPRIT, answers: { ...ALL_RIGHT, how: '잠이 안 온다길래 약을 꺼내 줘 스스로 먹게 했다', why: '' } };
const wrong: ReportDraft = { culprit: 'B', answers: {} };

/** 화면 전체를 차지하는 장면은 게임 화면 크기로 띄운다 */
const Full = ({ children }: { children: React.ReactNode }) => <div style={{ width: 1440, height: 900, position: 'relative', overflow: 'hidden' }}>{children}</div>;

export const 엔딩_해결: Story = { parameters: { game: ended(perfect, 'result') }, render: () => <Full><Result /></Full> };
export const 엔딩_미해결: Story = { parameters: { game: ended(insufficient, 'result') }, render: () => <Full><Result /></Full> };
export const 엔딩_오인: Story = { parameters: { game: ended(wrong, 'result', ['A-01', 'B-01', 'C-01']) }, render: () => <Full><Result /></Full> };

export const 진상_해설: Story = { parameters: { game: ended(perfect, 'epilogue') }, render: () => <Full><Epilogue /></Full> };

export const 사건_이후: Story = { parameters: { game: ended(perfect, 'afterword') }, render: () => <Full><Afterword /></Full> };
export const 사건_이후_반려: Story = { parameters: { game: ended(insufficient, 'afterword', ['A-01', 'B-01', 'C-01', 'C-05']) }, render: () => <Full><Afterword /></Full> };
