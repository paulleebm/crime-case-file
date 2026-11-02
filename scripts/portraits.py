"""인물 초상 크기별 파일 만들기 (2026-10-16).

생성 원본(PNG)을 색·대비·질감은 손대지 않고 크기만 줄인다.
화면에서 38px짜리 초상을 640px 그림에서 한 번에 줄이면 흐릿하고 거칠어지므로, 미리 여러 크기를 만들어 두고 브라우저가 고르게 한다.
원본은 design/evidence-production/originals/portraits/ 에 둔다 (없으면 생성 기록의 경로에서 복사한다).
사용: python scripts/portraits.py
"""
import json
import shutil
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src/assets/portraits'
KEEP = ROOT / 'design/evidence-production/originals/portraits'
LOG = ROOT / 'design/evidence-production/site-art-generation-log.json'
WIDTHS = [96, 192, 384, 768]

KEEP.mkdir(parents=True, exist_ok=True)
sources = {a['name']: a['source'] for a in json.loads(LOG.read_text(encoding='utf-8'))['assets']}
for p in 'ABCV':
    keep = KEEP / f'portrait-{p}.png'
    if not keep.exists():
        shutil.copy2(sources[f'portrait-{p}'], keep)
    im = Image.open(keep).convert('RGB')
    for w in WIDTHS:
        h = round(im.height * w / im.width)
        im.resize((w, h), Image.LANCZOS).save(OUT / f'portrait-{p}-{w}.webp', 'WEBP', quality=94, method=6)
    print(p, im.size, '->', WIDTHS)
