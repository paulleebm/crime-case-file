import type { Meta, StoryObj } from '@storybook/react-vite';
import { Portrait } from '../sketch/components';

const meta = {
  title: '그림/초상화',
  component: Portrait,
  args: { person: 'A', w: 64, h: 78 },
  argTypes: { person: { control: 'inline-radio', options: ['A', 'B', 'C', 'V'] } },
} satisfies Meta<typeof Portrait>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 한사람: Story = {};

/** 화면에 쓰이는 크기 모두 (보고서 30, 지도 말 42, 목록 38, 관계인 탭 64) */
export const 전체: Story = {
  render: () => (
    <div style={{ display: 'grid', gap: 16 }}>
      {[30, 38, 42, 64, 128].map((w) => (
        <div key={w} style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <span className="code" style={{ width: 40 }}>{w}px</span>
          {(['A', 'B', 'C', 'V'] as const).map((p) => <Portrait key={p} person={p} w={w} h={Math.round(w * 1.22)} />)}
        </div>
      ))}
    </div>
  ),
};
