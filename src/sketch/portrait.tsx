import type { PersonId } from '../data/types';

// 인물 초상. 생성 원본을 크기만 줄인 파일(scripts/portraits.py)을 여러 크기로 두고, 브라우저가 화면 크기에 맞는 것을 고른다.
// 큰 그림 하나를 아주 작게 줄여 띄우면 흐릿하고 거칠어진다.
const FILES = import.meta.glob('../assets/portraits/portrait-*-*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const NAMES: Record<PersonId | 'V', string> = { A: '류준서', B: '서민아', C: '문태준', V: '류정환' };

/** 사람마다 [가로 픽셀, 주소] (작은 것부터) */
const SETS = Object.fromEntries((['A', 'B', 'C', 'V'] as const).map((p) => [p,
  Object.entries(FILES)
    .map(([path, url]) => [path.match(new RegExp(`portrait-${p}-(\\d+)\\.webp$`))?.[1], url] as const)
    .filter((x): x is [string, string] => !!x[0])
    .map(([w, url]) => [Number(w), url] as const)
    .sort((a, b) => a[0] - b[0]),
])) as Record<PersonId | 'V', (readonly [number, string])[]>;

/** 진상 장면과 같은 얼굴을 사용하는 인물 초상 */
export function Portrait({ person, w = 38, h = 46 }: { person: PersonId | 'V'; w?: number; h?: number }) {
  const set = SETS[person];
  const fallback = set.find(([width]) => width >= w * 2)?.[1] ?? set[set.length - 1]?.[1];
  return (
    <img className="portrait" src={fallback} srcSet={set.map(([width, url]) => `${url} ${width}w`).join(', ')} sizes={`${w}px`}
      alt={`${NAMES[person]} 초상`} width={w} height={h} decoding="async" />
  );
}
