#!/usr/bin/env python3
"""產生 PWA App 圖示:綠色圓角底 + 葉片標誌。"""
from PIL import Image, ImageDraw
import os, math

OUT = os.path.join(os.path.dirname(__file__), "icons")
os.makedirs(OUT, exist_ok=True)

GREEN = (47, 125, 59)
GREEN2 = (74, 157, 85)
WHITE = (255, 255, 255)


def vgrad(size, top, bot):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
        for x in range(size):
            px[x, y] = c
    return img


def leaf(draw, cx, cy, s, color):
    """畫一片簡單的葉子(兩段圓弧 + 中脈)。"""
    pts = []
    for a in range(0, 181, 6):
        r = math.radians(a)
        pts.append((cx + s * math.sin(r) * 0.55, cy - s * 0.6 + s * (a / 180)))
    for a in range(180, 361, 6):
        r = math.radians(a)
        pts.append((cx + s * math.sin(r) * 0.55, cy - s * 0.6 + s * ((360 - a) / 180)))
    draw.polygon(pts, fill=color)


def make(size, maskable=False):
    img = vgrad(size, GREEN2, GREEN)
    draw = ImageDraw.Draw(img)
    if not maskable:
        # 圓角遮罩
        mask = Image.new("L", (size, size), 0)
        m = ImageDraw.Draw(mask)
        rad = int(size * 0.22)
        m.rounded_rectangle([0, 0, size, size], radius=rad, fill=255)
        img.putalpha(mask)
    else:
        img = img.convert("RGBA")
    d = ImageDraw.Draw(img)
    # 主葉 + 側葉
    leaf(d, size * 0.5, size * 0.52, size * 0.42, WHITE)
    # 葉脈
    d.line([(size * 0.5, size * 0.28), (size * 0.5, size * 0.74)],
           fill=GREEN, width=max(2, size // 60))
    for k in range(1, 4):
        yy = size * (0.36 + k * 0.09)
        off = size * 0.10 * (1 - k * 0.15)
        d.line([(size * 0.5, yy), (size * 0.5 - off, yy - off * 0.6)], fill=GREEN, width=max(2, size // 70))
        d.line([(size * 0.5, yy), (size * 0.5 + off, yy - off * 0.6)], fill=GREEN, width=max(2, size // 70))
    return img


make(192).save(os.path.join(OUT, "icon-192.png"))
make(512).save(os.path.join(OUT, "icon-512.png"))
make(512, maskable=True).save(os.path.join(OUT, "icon-maskable-512.png"))
print("icons written to", OUT)
