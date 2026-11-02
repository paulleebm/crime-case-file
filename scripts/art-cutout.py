"""생성 일러스트 후처리 (2026-10-16).

- cover-files: 종이 배경을 투명하게 오려 낸다(누끼). 테두리에서 이어진 배경만 지우고, 그 안의 연필 그림자는 반투명으로 남긴다.
- episode-*: 가장자리의 바랜 종이 여백을 잘라 그림이 액자를 꽉 채우게 한다.

원본은 design/evidence-production/originals/ 에 한 번만 보관하고, 다시 돌리면 원본에서 새로 만든다.
사용: python scripts/art-cutout.py
"""
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / 'src/assets/illustrations'
KEEP = ROOT / 'design/evidence-production/originals'


def original(name: str) -> Image.Image:
    KEEP.mkdir(parents=True, exist_ok=True)
    src, keep = ART / f'{name}.webp', KEEP / f'{name}.webp'
    if not keep.exists():
        shutil.copy2(src, keep)
    return Image.open(keep).convert('RGB')


def cutout(name: str, tol: float = 16, shadow: float = 70) -> None:
    im = original(name)
    a = np.asarray(im).astype(np.float32)
    h, w, _ = a.shape
    border = np.concatenate([a[:6].reshape(-1, 3), a[-6:].reshape(-1, 3), a[:, :6].reshape(-1, 3), a[:, -6:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    diff = np.abs(a - bg).max(axis=2)
    # 테두리와 이어진 배경색 영역 (연필 그림자도 배경 쪽으로 넓게 잡는다)
    lum = a.mean(axis=2)
    bglum = bg.mean()
    near = (diff < tol) | ((bglum - lum) < shadow) & (np.abs(a - a.mean(axis=2, keepdims=True)).max(axis=2) < 14)
    near = ndimage.binary_opening(near, iterations=1)
    lab, _ = ndimage.label(near)
    edge_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    region = np.isin(lab, list(edge_labels))
    # 배경 영역: 어두운 만큼(연필 그림자)만 남긴다
    dark = np.clip((bglum - lum) / shadow, 0, 1) ** 0.8
    alpha = np.where(region, dark * 0.85, 1.0)
    # 경계를 부드럽게
    soft = np.asarray(Image.fromarray((alpha * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(np.float32) / 255
    alpha = np.where(region, np.minimum(soft, alpha + 0.15), np.maximum(alpha, soft))
    rgb = np.where(region[..., None], np.clip(a * 0.55, 0, 255), a)  # 그림자는 짙은 연필색으로
    out = np.dstack([rgb, alpha * 255]).astype(np.uint8)
    Image.fromarray(out, 'RGBA').save(ART / f'{name}.webp', 'WEBP', quality=90, method=6)
    print(name, 'cutout', f'bg={bg.round()}', f'transparent={(alpha < 0.05).mean():.0%}')


def crop_margin(name: str, frac: float = 0.055) -> None:
    im = original(name)
    w, h = im.size
    dx, dy = int(w * frac), int(h * frac)
    im.crop((dx, dy, w - dx, h - dy)).save(ART / f'{name}.webp', 'WEBP', quality=90, method=6)
    print(name, 'crop', im.size, '->', (w - 2 * dx, h - 2 * dy))


if __name__ == '__main__':
    cutout('cover-files')
    crop_margin('episode-trophy')
    crop_margin('episode-sealed')
