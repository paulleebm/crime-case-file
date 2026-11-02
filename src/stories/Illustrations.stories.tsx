import type { Meta, StoryObj } from '@storybook/react-vite';
import { Sketch } from '../data/illustrations';
import { EvidencePhoto } from '../data/forensicPhotos';
import { EpisodeArt } from '../ui/CoverArt';

const meta = {
  title: '그림/자료 그림',
  component: Sketch,
  args: { name: 'office-forensic', width: 600 },
  argTypes: { name: { control: 'select', options: ['facade', 'office-forensic', 'trophy', 'trophy-underside'] } },
} satisfies Meta<typeof Sketch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const 골라보기: Story = {};

export const 감식_약도: Story = { args: { name: 'office-forensic', width: 600 } };

export const 감식_사진: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 480px)', gap: 12 }}>
      {['gt-scene', 'gt-bath', 'gt-trophy', 'gt-base', 'gt-underside', 'gt-luminol'].map((n) => <EvidencePhoto key={n} name={n} width={480} />)}
    </div>
  ),
};

export const 사건_목록_그림: Story = { render: () => <EpisodeArt name="discovery" size={600} /> };
