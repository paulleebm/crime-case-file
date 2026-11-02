import { useMemo } from 'react';
import { Ink } from '../sketch/components';
import { hashSeed, line, rng, type Stroke } from '../sketch/sketch';
import files from '../assets/illustrations/cover-files.webp';
import discovery from '../assets/illustrations/episode-discovery.webp';
import sealed from '../assets/illustrations/episode-sealed.webp';
/** 생성한 원화를 사용하는 에피소드 표지. */
export function EpisodeArt({ name, size = 280 }: { name: string; size?: number }) {
  return <img className={`episode-art ${name === 'discovery' ? 'seamless-art' : ''}`} src={name === 'discovery' ? discovery : sealed} alt="" width={size} height={size} />;
}
/** 표지의 사건 서류철 원화. */
export function FileStack({ width = 260 }: { width?: number }) {
  return <img className="cover-files-art" src={files} alt="" width={width} style={{ maxWidth: '100%', height: 'auto' }} />;
}
/** 연필로 그린 집 모양 홈 아이콘 */
export function HomeIcon({ size = 22 }: { size?: number }) {
  const strokes = useMemo(() => {
    const o: Stroke[] = [];
    const r = rng(hashSeed('home-icon'));
    const op = { os: 1.2, w: 1.5, j: 0.35 };
    // 지붕
    line(o, r, 2.5, 11.5, 12, 3, op);
    line(o, r, 12, 3, 21.5, 11.5, op);
    // 굴뚝
    line(o, r, 16.5, 7, 16.5, 3.5, { ...op, os: 0.4, w: 1.2 });
    line(o, r, 16.5, 3.5, 19, 3.5, { ...op, os: 0.4, w: 1.2 });
    line(o, r, 19, 3.5, 19, 9.5, { ...op, os: 0.4, w: 1.2 });
    // 몸체
    line(o, r, 5, 10, 5, 21, op);
    line(o, r, 19, 10, 19, 21, op);
    line(o, r, 4, 21, 20, 21, op);
    // 문
    line(o, r, 10, 21, 10, 15, { ...op, w: 1.1, os: 0.5 });
    line(o, r, 10, 15, 14, 15, { ...op, w: 1.1, os: 0.5 });
    line(o, r, 14, 15, 14, 21, { ...op, w: 1.1, os: 0.5 });
    return o;
  }, []);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      <Ink strokes={strokes} />
    </svg>
  );
}
