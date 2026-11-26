"""Detect hex outlines via adaptive per-box thresholds and compare shapes by IoU."""
from PIL import Image
import numpy as np
from scipy import ndimage

img = np.asarray(Image.open('/tmp/s1.png').convert('RGB')).astype(int)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
bright = (mn > 140) & (mx - mn < 70)

boxes = {
    'A': (558, 237, 615, 295),
    'B': (663, 200, 740, 262),
    'C': (588, 335, 668, 435),
    'D': (720, 295, 778, 365),
}
outlines = {}
for k, (x0, y0, x1, y1) in boxes.items():
    m = np.zeros_like(bright)
    m[y0:y1 + 1, x0:x1 + 1] = bright[y0:y1 + 1, x0:x1 + 1]
    # largest connected component in box
    lbl, n = ndimage.label(m, structure=np.ones((3, 3)))
    if n == 0:
        print(k, 'none'); continue
    sizes = ndimage.sum(m, lbl, range(1, n + 1))
    big = (lbl == (np.argmax(sizes) + 1))
    ys, xs = np.where(big)
    outlines[k] = big
    print(f'{k}: bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()} px {int(big.sum())} of box ({x0},{y0})-({x1},{y1})')

# tray pieces: dark on gray tray bg; tray area x>860
dark = (mx < 110)
tray = np.zeros_like(dark)
tray[150:460, 862:1002] = dark[150:460, 862:1002]
lbl, n = ndimage.label(tray, structure=np.ones((3, 3)))
sizes = ndimage.sum(tray, lbl, range(1, n + 1))
order = np.argsort(sizes)[::-1][:2]
pieces = {}
names = ['TOP', 'BOT']
for idx, oi in enumerate(order):
    m = (lbl == oi + 1)
    ys, xs = np.where(m)
    pieces[names[idx]] = m
    print(f'piece {names[idx]}: bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()} px {int(m.sum())}')


def norm(mask, out_w=64):
    ys, xs = np.where(mask)
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(float)
    im = Image.fromarray((sub * 255).astype(np.uint8))
    w, h = im.size
    im2 = im.resize((out_w, max(1, int(h * out_w / w))))
    return (np.asarray(im2) > 100).astype(float)


def iou(p, q):
    h = max(p.shape[0], q.shape[0]); w = max(p.shape[1], q.shape[1])
    P = np.zeros((h, w)); Q = np.zeros((h, w))
    P[:p.shape[0], :p.shape[1]] = p
    Q[:q.shape[0], :q.shape[1]] = q
    inter = (P * Q).sum(); union = ((P + Q) > 0).sum()
    return inter / union if union else 0.0


print('\n--- IoU matrix ---')
for pn, pm in pieces.items():
    row = {k: round(iou(norm(pm), norm(om)), 3) for k, om in outlines.items()}
    print(pn, row)

print('\n--- aspect ratios (w/h) ---')
for k, om in outlines.items():
    ys, xs = np.where(om)
    print(k, round((xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1), 2))
for pn, pm in pieces.items():
    ys, xs = np.where(pm)
    print(pn, round((xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1), 2))
