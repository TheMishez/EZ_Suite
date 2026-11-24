"""Draws the Stream Deck plugin images (keys, action list icons, category, plugin icon).
Run: python tools/make_streamdeck_images.py   (needs Pillow)"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'streamdeck', 'com.ezggco.ezsoundboard.sdPlugin', 'images')
LOGO = os.path.join(ROOT, 'assets', 'logo', 'ez-soundboard-icon-512.png')
YELLOW = (255, 210, 31, 255)
BG = (11, 12, 15, 255)
WHITE = (255, 255, 255, 255)
S = 576  # draw big, scale down


def glyph(d, name, col, box):
    x0, y0, x1, y1 = box
    w = x1 - x0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    lw = max(2, int(w * 0.075))
    if name == 'play':
        d.polygon([(x0 + w * 0.26, y0 + w * 0.14), (x0 + w * 0.26, y1 - w * 0.14), (x1 - w * 0.12, cy)], fill=col)
    elif name == 'wave':
        bars = [0.35, 0.7, 1.0, 0.55, 0.85, 0.4]
        n = len(bars)
        bw = w / (n * 1.6)
        for i, h in enumerate(bars):
            bx = x0 + w * 0.1 + i * (w * 0.8 / (n - 1)) - bw / 2
            hh = h * w * 0.8 / 2
            d.rounded_rectangle([bx, cy - hh, bx + bw, cy + hh], radius=bw / 2, fill=col)
    elif name == 'stop':
        m = w * 0.2
        d.rounded_rectangle([x0 + m, y0 + m, x1 - m, y1 - m], radius=w * 0.1, fill=col)
    elif name == 'speak':
        m = w * 0.1
        d.rounded_rectangle([x0 + m, y0 + w * 0.14, x1 - m, y0 + w * 0.72], radius=w * 0.12, outline=col, width=lw)
        d.polygon([(x0 + w * 0.26, y0 + w * 0.68), (x0 + w * 0.26, y0 + w * 0.9), (x0 + w * 0.48, y0 + w * 0.7)], fill=col)
        for i, ln in enumerate([0.56, 0.38]):
            yy = y0 + w * (0.34 + i * 0.17)
            d.rounded_rectangle([x0 + w * 0.24, yy - lw / 2, x0 + w * (0.24 + ln), yy + lw / 2], radius=lw / 2, fill=col)
    elif name in ('mic', 'micoff'):
        d.rounded_rectangle([cx - w * 0.14, y0 + w * 0.08, cx + w * 0.14, y0 + w * 0.58], radius=w * 0.14, fill=col)
        d.arc([cx - w * 0.28, y0 + w * 0.22, cx + w * 0.28, y0 + w * 0.72], 0, 180, fill=col, width=lw)
        d.line([cx, y0 + w * 0.72, cx, y0 + w * 0.88], fill=col, width=lw)
        d.line([cx - w * 0.16, y0 + w * 0.88, cx + w * 0.16, y0 + w * 0.88], fill=col, width=lw)
        if name == 'micoff':
            d.line([x0 + w * 0.14, y0 + w * 0.1, x1 - w * 0.14, y1 - w * 0.06], fill=col, width=int(lw * 1.3))


def key(name, glyph_name, on=False, glyph_box=0.42):
    img = Image.new('RGBA', (S, S), YELLOW if on else BG)
    d = ImageDraw.Draw(img)
    if not on:  # subtle yellow frame so the keys read as one set
        d.rounded_rectangle([18, 18, S - 18, S - 18], radius=70, outline=(255, 210, 31, 70), width=8)
    g = S * glyph_box
    top = S * 0.14
    glyph(d, glyph_name, BG if on else YELLOW, (S / 2 - g / 2, top, S / 2 + g / 2, top + g))
    for size, suffix in ((72, ''), (144, '@2x')):
        img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'{name}{suffix}.png'))


def icon(name, glyph_name, sizes):
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    glyph(d, glyph_name, WHITE, (S * 0.06, S * 0.06, S * 0.94, S * 0.94))
    for size, suffix in sizes:
        img.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'{name}{suffix}.png'))


def main():
    os.makedirs(OUT, exist_ok=True)
    key('key-play', 'wave')
    key('key-playing', 'wave', on=True)
    key('key-stop', 'stop')
    key('key-tts', 'speak')
    key('key-mic-on', 'mic')
    key('key-mic-off', 'micoff', glyph_box=0.42)
    small = ((20, ''), (40, '@2x'))
    icon('action-play', 'play', small)
    icon('action-stop', 'stop', small)
    icon('action-tts', 'speak', small)
    icon('action-mic', 'mic', small)
    icon('category', 'wave', ((28, ''), (56, '@2x')))
    logo = Image.open(LOGO).convert('RGBA')
    for size, suffix in ((256, ''), (512, '@2x')):
        logo.resize((size, size), Image.LANCZOS).save(os.path.join(OUT, f'plugin{suffix}.png'))
    print('wrote', len(os.listdir(OUT)), 'images to', OUT)


if __name__ == '__main__':
    main()
