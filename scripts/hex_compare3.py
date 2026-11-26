"""Robust comparison: strip Move chips from pieces, fill outline interiors, IoU."""
from PIL import Image
import numpy as np
from scipy import ndimage

img = np.asarray(Image.open('/tmp/s1.png').convert('RGB')).astype(int)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
bright = (mn > 140) & (mx - mn < 70)
dark = (mx < 110)

boxes = {
    'A': (558, 237, 615, 295),
    'B': (663, 200, 740, 262),
    'C': (588, 335, 668, 435),
    'D': (720, 295, 778, 365),
}

def fill_outline(m):
    # flood fill from border on the inverse; interior = not reachable & not line
    inv = ~m
    lbl, n = ndimage.label(inv)
    border_labels = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border_labels.discard(0)
    interior = inv & ~np.isin(lbl, list(border_labels))
    return m | interior

filled = {}
for k, (x0, y0, x1, y1) in boxes.items():
    m = np.zeros_like(bright)
    m[y0:y1 + 1, x0:x1 + 1] = bright[y0:y1 + 1, x0:x1 + 1]
    lbl, n = ndimage.label(m, structure=np.ones((3, 3)))
    sizes = ndimage.sum(m, lbl, range(1, n + 1))
    big = (lbl == (np.argmax(sizes) + 1))
    f = fill_outline(big)
    filled[k] = f
    ys, xs = np.where(f)
    print(f'outline {k}: filled bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()} area {int(f.sum())} aspect {(xs.max()-xs.min()+1)/(ys.max()-ys.min()+1):.2f}')

# pieces: dark, minus chips. Chips are navy (b > r significantly). piece dark gray r≈g≈b
graydark = dark & (np.abs(r - b) < 25)
top_box = (860, 168, 1002, 240)   # below the top chip (chip ~y145-166)
bot_box = (860, 318, 1002, 392)   # below the bottom chip (~y296-317)
pieces = {}
for name, (x0, y0, x1, y1) in {'TOP': top_box, 'BOT': bot_box}.items():
    m = np.zeros_like(graydark)
    m[y0:y1 + 1, x0:x1 + 1] = graydark[y0:y1 + 1, x0:x1 + 1]
    lbl, n = ndimage.label(m, structure=np.ones((3, 3)))
    sizes = ndimage.sum(m, lbl, range(1, n + 1))
    big = (lbl == (np.argmax(sizes) + 1))
    pieces[name] = big
    ys, xs = np.where(big)
    print(f'piece {name}: bbox x {xs.min()}-{xs.max()} y {ys.min()}-{ys.max()} area {int(big.sum())} aspect {(xs.max()-xs.min()+1)/(ys.max()-ys.min()+1):.2f}')

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

print('\n--- IoU (filled outlines vs pieces) ---')
for pn, pm in pieces.items():
    pmn = norm(pm)
    scores = {k: round(iou(pmn, norm(om)), 3) for k, om in filled.items()}
    best = max(scores, key=scores.get)
    print(f'{pn}: {scores}  -> BEST: {best}')
