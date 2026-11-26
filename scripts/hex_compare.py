"""Compare hexagon cluster shapes between white outlines in the challenge image
and the dark tray pieces, using mask normalization + IoU."""
from PIL import Image
import numpy as np
from scipy import ndimage

img = Image.open('/tmp/s1.png').convert('RGB')
a = np.asarray(img).astype(int)

r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
white = (mn > 150) & (mx - mn < 45)
dark = (mx < 110) & (r < 110)

img_area = np.zeros_like(white)
img_area[143:460, 510:1002] = True
outline_mask = white & img_area

tray_area = np.zeros_like(dark)
tray_area[150:460, 862:1000] = True
piece_mask = dark & tray_area

lbl, n = ndimage.label(outline_mask, structure=np.ones((3, 3)))
print('outline clusters:', n)
sizes = ndimage.sum(outline_mask, lbl, range(1, n + 1))
order = np.argsort(sizes)[::-1][:4]
outlines = []
for oi in order:
    m = (lbl == oi + 1)
    ys, xs = np.where(m)
    outlines.append(m)
    print(f'outline: x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}, px {int(m.sum())}')

lbl2, n2 = ndimage.label(piece_mask, structure=np.ones((3, 3)))
print('piece clusters:', n2)
sizes2 = ndimage.sum(piece_mask, lbl2, range(1, n2 + 1))
order2 = np.argsort(sizes2)[::-1][:3]
pieces = []
for oi in order2:
    m = (lbl2 == oi + 1)
    ys, xs = np.where(m)
    pieces.append(m)
    print(f'piece: x {xs.min()}-{xs.max()}, y {ys.min()}-{ys.max()}, px {int(m.sum())}')


def norm_crop(mask, out_h=80, out_w=80):
    ys, xs = np.where(mask)
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(float)
    im = Image.fromarray((sub * 255).astype(np.uint8))
    # keep aspect: resize by width
    w, h = im.size
    scale = out_w / w
    im2 = im.resize((out_w, max(1, int(h * scale))))
    return (np.asarray(im2) > 100).astype(float)


def iou(a, b):
    # pad to same size
    h = max(a.shape[0], b.shape[0]); w = max(a.shape[1], b.shape[1])
    A = np.zeros((h, w)); B = np.zeros((h, w))
    A[:a.shape[0], :a.shape[1]] = a
    B[:b.shape[0], :b.shape[1]] = b
    inter = (A * B).sum(); union = ((A + B) > 0).sum()
    return inter / union if union else 0


print('\n--- shape comparison (IoU, aspect-preserving) ---')
for i, p in enumerate(pieces):
    pm = norm_crop(p)
    for j, o in enumerate(outlines):
        om = norm_crop(o)
        print(f'piece{i+1} vs outline{j+1}: IoU={iou(pm, om):.3f}')
