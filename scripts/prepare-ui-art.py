import json
import shutil
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
manifest = json.loads((ROOT / 'design/evidence-production/ui-refresh-generation-log.json').read_text(encoding='utf-8'))
icon_sizes = {'icon-home': 48, 'icon-hint': 36, 'icon-radio': 48, 'icon-team': 104, 'icon-tray': 36, 'icon-close': 24}
report = []
for asset in manifest['assets']:
    if sys.argv[1:] and asset['name'] not in sys.argv[1:]:
        continue
    original = ROOT / asset['original']
    original.parent.mkdir(parents=True, exist_ok=True)
    if not original.exists():
        shutil.copy2(asset['source'], original)
    image = Image.open(original)
    name = asset['name']
    if name.startswith('truth-'):
        size = (1600, 900)
    elif name in icon_sizes:
        size = (icon_sizes[name], icon_sizes[name])
    elif name.startswith('seal-'):
        size = (128, 128)
    elif name == 'stamp-witness':
        size = (192, 64)
    else:
        longest = 1600 if name.startswith('gt-') or name == 'office-plan' else 1000 if name.startswith('episode-') else 800
        ratio = min(1, longest / max(image.size))
        size = tuple(round(dimension * ratio) for dimension in image.size)
    output = image.resize(size, Image.Resampling.LANCZOS)
    destination = ROOT / asset['dest']
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, 'WEBP', quality=90, method=6, exact=True)
    rgba = image.convert('RGBA')
    corners = [rgba.getpixel(point) for point in [(0, 0), (rgba.width - 1, 0), (0, rgba.height - 1), (rgba.width - 1, rgba.height - 1)]]
    report.append({'name': name, 'size': size, 'bytes': destination.stat().st_size, 'sourceCorners': corners, 'alpha': image.mode == 'RGBA'})
print(json.dumps(report, ensure_ascii=False, indent=2))
