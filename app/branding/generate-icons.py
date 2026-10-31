#!/usr/bin/env python3
"""
Generate the Achmage Edition app icons: the Zotero icon with the Achmage mark as a badge.

Requires Pillow and rsvg-convert. Run from the repository root:

    python3 app/branding/generate-icons.py

Inputs:  app/branding/zotero-original.ico (the stock Zotero icon), app/branding/badge.svg
Outputs: app/linux/icons/icon{32,64,128}.png, app/win/zotero.ico,
         app/mac/Contents/Resources/zotero.icns, app/branding/window-icons/
"""
import io
import os
import subprocess
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BRANDING = os.path.join(ROOT, 'app', 'branding')


def path(*parts):
    return os.path.join(ROOT, *parts)


def base_icon(size, frames):
    """The stock icon at the given size, from the closest larger frame"""
    if size in frames:
        return frames[size].copy()
    larger = sorted(s for s in frames if s >= size) or [max(frames)]
    return frames[larger[0]].resize((size, size), Image.LANCZOS)


def badge(size):
    png = subprocess.run(
        ['rsvg-convert', '-w', str(size), '-h', str(size), os.path.join(BRANDING, 'badge.svg')],
        check=True, capture_output=True
    ).stdout
    return Image.open(io.BytesIO(png)).convert('RGBA')


def badged(size, frames):
    icon = base_icon(size, frames).convert('RGBA')
    # Small icons need a relatively larger badge to stay visible
    ratio = 0.5 if size >= 64 else {48: 0.52, 32: 0.56, 24: 0.6}.get(size, 0.62)
    diameter = max(6, round(size * ratio))
    margin = round(size * 0.01)
    icon.alpha_composite(badge(diameter), (size - diameter - margin, size - diameter - margin))
    return icon


def main():
    original = Image.open(os.path.join(BRANDING, 'zotero-original.ico'))
    frames = {}
    for size in original.info['sizes']:
        original.size = size
        frames[size[0]] = original.copy().convert('RGBA')

    # Linux launcher icons
    for size in (32, 64, 128):
        badged(size, frames).save(path('app', 'linux', 'icons', f'icon{size}.png'))

    # Windows icon (also embedded in zotero.exe by the fork build)
    win_sizes = [16, 24, 32, 48, 256]
    win_icons = {s: badged(s, frames) for s in win_sizes}
    win_icons[256].save(
        path('app', 'win', 'zotero.ico'),
        format='ICO',
        sizes=[(s, s) for s in win_sizes],
        append_images=[win_icons[s] for s in win_sizes[:-1]],
    )

    # macOS icon -- the stock icon only goes up to 256 px, so larger sizes are upscaled
    mac_sizes = [16, 32, 64, 128, 256, 512, 1024]
    mac_icons = [badged(s, frames) for s in mac_sizes]
    mac_icons[-1].save(
        path('app', 'mac', 'Contents', 'Resources', 'zotero.icns'),
        format='ICNS',
        append_images=mac_icons[:-1],
    )

    # Window icons, copied by the fork build to <app>/chrome/icons/default
    out = os.path.join(BRANDING, 'window-icons')
    os.makedirs(out, exist_ok=True)
    for name in ('default', 'main-window'):
        win_icons[256].save(
            os.path.join(out, f'{name}.ico'),
            format='ICO',
            sizes=[(s, s) for s in win_sizes],
            append_images=[win_icons[s] for s in win_sizes[:-1]],
        )
        for size in (16, 32, 48, 64, 128):
            badged(size, frames).save(os.path.join(out, f'{name}{size}.png'))
        badged(128, frames).save(os.path.join(out, f'{name}.png'))

    print("Icons generated")


if __name__ == '__main__':
    sys.exit(main())
