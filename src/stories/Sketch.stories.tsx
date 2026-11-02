import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Check, RedMark, Seal } from '../sketch/components';

const meta = {
  title: '바탕/연필 부품',
  component: Box,
  args: { mode: 'single', children: '연필 상자' },
  argTypes: { mode: { control: 'inline-radio', options: ['single', 'double', 'dash'] } },
} satisfies Meta<typeof Box>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 상자: Story = { render: (a) => <Box {...a} style={{ padding: 16, width: 260 }} /> };

export const 버튼: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 10 }}>
      <Box as="button" className="btn" seed="s1">보통</Box>
      <Box as="button" className="btn" mode="double" seed="s2">강조</Box>
      <Box as="button" className="btn small" seed="s3">작게</Box>
    </div>
  ),
};

export const 도장과_표시: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
      <Seal text="정정" size={40} />
      <Seal text="기밀" size={56} />
      <span style={{ position: 'relative', padding: '4px 10px' }}>동그라미<RedMark kind="circle" seed="r1" /></span>
      <span style={{ position: 'relative', padding: '4px 10px' }}>가위표<RedMark kind="cross" seed="r2" /></span>
      <span style={{ position: 'relative', padding: '4px 10px' }}>취소선<RedMark kind="strike" seed="r3" /></span>
      <Check on />
      <Check on={false} />
    </div>
  ),
};
