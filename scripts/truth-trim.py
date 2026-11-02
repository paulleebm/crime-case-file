"""진상 해설 장면 그림의 가장자리 종이 여백 잘라 내기 (2026-10-16).

생성 그림은 가장자리에 밝은 종이 여백이 있어서, 화면에서 그림 둘레만 하얗게 뜬다.
원본 PNG에서 네 변의 여백 폭을 재고(밝은 띠가 끝나는 곳) 16:9를 지키며 잘라 낸 뒤 1600×900으로 맞춘다. 색·대비는 건드리지 않는다.
원본은 design/evidence-production/originals/truth/ 에 둔다 (없으면 생성 기록의 경로에서 복사한다).
사용: python scripts/truth-trim.py
      python scripts/truth-trim.py --keep-paper   종이색을 판 색(#e4e0d9)에 맞춰 다시 그린 그림: 자르지 않고 크기만 맞추고, 네 모서리 색을 검사한다
"""
import json
import shutil
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/assets/truth'
KEEP = ROOT / 'design/evidence-production/originals/truth'
LOG = ROOT / 'design/evidence-production/site-art-generation-log.json'
W, H = 1600, 900
MAX_FRAC = 0.09  # 한 변에서 잘라 낼 수 있는 최대 비율


def margin(lines: np.ndarray, edge: float) -> int:
    """가장자리 띠가 끝나는 위치: 줄 평균 밝기가 가장자리보다 확실히 어두워지는 첫 줄"""
    limit = int(len(lines) * MAX_FRAC)
    for i in range(limit):
        if lines[i] < edge - 14:
            return i
    return limit


PANEL = np.array([0xE4, 0xE0, 0xD9], dtype=np.float32)  # styles.css --panel
TOL = 4


def keep_paper(name: str, im: Image.Image) -> None:
    """종이 가장자리를 살린 그림: 자르지 않고 크기만 맞춘다. 네 모서리 종이색이 판 색과 맞는지 알려 준다"""
    a = np.asarray(im).astype(np.float32)
    k = max(8, im.width // 60)
    corners = [a[:k, :k], a[:k, -k:], a[-k:, :k], a[-k:, -k:]]
    worst = max(float(np.abs(c.reshape(-1, 3).mean(axis=0) - PANEL).max()) for c in corners)
    im.resize((W, H), Image.LANCZOS).save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6)
    print(f'{name:22} {im.size} -> {W}x{H}  모서리 색 차이 {worst:4.1f} {"OK" if worst <= TOL else "판 색과 다름 — 다시 맞춰야 함"}')


KEEP.mkdir(parents=True, exist_ok=True)
sources = {a['name']: a['source'] for a in json.loads(LOG.read_text(encoding='utf-8'))['assets']}
for name in sorted(n for n in sources if n.startswith('truth-')):
    keep = KEEP / f'{name}.png'
    if not keep.exists():
        shutil.copy2(sources[name], keep)
    im = Image.open(keep).convert('RGB')
    if '--keep-paper' in sys.argv:
        keep_paper(name, im)
        continue
    g = np.asarray(im.convert('L')).astype(np.float32)
    h, w = g.shape
    rows, cols = g.mean(axis=1), g.mean(axis=0)
    top = margin(rows, rows[:3].mean())
    bottom = margin(rows[::-1], rows[-3:].mean())
    left = margin(cols, cols[:3].mean())
    right = margin(cols[::-1], cols[-3:].mean())
    # 여백이 남지 않게 더 큰 쪽에 맞춰 16:9로 자른다 (가운데 기준)
    cw = w - left - right
    ch = h - top - bottom
    if cw / ch > W / H:
        nw = round(ch * W / H)
        left += (cw - nw) // 2
        cw = nw
    else:
        nh = round(cw * H / W)
        top += (ch - nh) // 2
        ch = nh
    im.crop((left, top, left + cw, top + ch)).resize((W, H), Image.LANCZOS).save(OUT / f'{name}.webp', 'WEBP', quality=90, method=6)
    print(f'{name:22} {im.size} trim t{top} b{bottom} l{left} r{right} -> {cw}x{ch}')
