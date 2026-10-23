#!/usr/bin/env python3
"""Swap Sync.audio brand: crop uploaded wordmark -> public/logo.png, regen PWA icons."""
import numpy as np
from PIL import Image

SRC = "/home/z/my-project/upload/Black and Red Bold Creative Scribble Artist Logo.png"
PUB = "/home/z/my-project/public"

img = Image.open(SRC).convert("RGB")
a = np.array(img)
print("source size:", img.size)

# bbox of anything not near-black (white text + cobalt glitch strokes)
mask = a.max(axis=2) > 20
ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
print("bbox:", x0, y0, x1, y1)

pad_x = int((x1 - x0) * 0.03)
pad_y = int((y1 - y0) * 0.22)  # extra vertical breathing room
box = (
    max(0, x0 - pad_x),
    max(0, y0 - pad_y),
    min(img.width, x1 + pad_x),
    min(img.height, y1 + pad_y),
)
logo = img.crop(box)
print("cropped:", logo.size, "aspect %.2f" % (logo.width / logo.height))
logo.save(f"{PUB}/logo.png", optimize=True)

# PWA icons: black canvas, centered wordmark. 512 is maskable-safe (76% <= 80% zone).
SPECS = [
    ("icons/icon-512.png", 512, 0.76),
    ("icons/icon-192.png", 192, 0.84),
    ("icons/icon-64.png", 64, 0.84),
    ("icons/apple-touch-icon.png", 180, 0.84),
]
for rel, size, frac in SPECS:
    canvas = Image.new("RGB", (size, size), (0, 0, 0))
    w = round(size * frac)
    h = round(w * logo.height / logo.width)
    mark = logo.resize((w, h), Image.LANCZOS)
    canvas.paste(mark, ((size - w) // 2, (size - h) // 2))
    canvas.save(f"{PUB}/{rel}", optimize=True)
    print("icon:", rel, canvas.size, "mark", mark.size)
