"""Generalized hCaptcha hex-puzzle solver: given a screenshot path, detect white
hex outlines in the challenge image and dark pieces in the tray, match shapes,
and print drag source->target viewport coordinates."""
import sys
from PIL import Image
import numpy as np
from scipy import ndimage

path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ch.png'
img = np.asarray(Image.open(path).convert('RGB')).astype(int)
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx = np.maximum(np.maximum(r, g), b)
mn = np.minimum(np.minimum(r, g), b)
bright = (mn > 140) & (mx - mn < 70)
graydark = (mx < 115) & (np.abs(r - b) < 30)

H, W = img.shape[:2]
# main image area: challenge image occupies roughly x 508-860 for hex puzzles (tray right of it)
img_zone = np.zeros((H, W), bool)
img_zone[145:458, 512:1002] = True
tray_zone = np.zeros((H, W), bool)
tray_zone[150:455, 862:1002] = True

# dynamic: find the split between image area and tray: tray bg is uniform gray (~127)
# assume same layout as observed: image x 508-860, tray x 862-1002
img_zone[:, 858:] = False

def clusters(mask, min_px=200):
    lbl, n = ndimage.label(mask, structure=np.ones((3, 3)))
    out = []
    for i in range(1, n + 1):
        m = lbl == i
        px = int(m.sum())
        if px < min_px:
            continue
        ys, xs = np.where(m)
        out.append({'mask': m, 'cx': (xs.min() + xs.max()) / 2, 'cy': (ys.min() + ys.max()) / 2,
                    'w': xs.max() - xs.min() + 1, 'h': ys.max() - ys.min() + 1, 'px': px})
    return out

def fill_outline(m):
    inv = ~m
    lbl, n = ndimage.label(inv)
    border = set(lbl[0, :]) | set(lbl[-1, :]) | set(lbl[:, 0]) | set(lbl[:, -1])
    border.discard(0)
    interior = inv & ~np.isin(lbl, list(border))
    return m | interior

def norm(mask, out_w=64):
    ys, xs = np.where(mask)
    sub = mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1].astype(float)
    im = Image.fromarray((sub * 255).astype(np.uint8))
    w, h = im.size
    return (np.asarray(im.resize((out_w, max(1, int(h * out_w / w))))) > 100).astype(float)

def iou(p, q):
    h = max(p.shape[0], q.shape[0]); w = max(p.shape[1], q.shape[1])
    P = np.zeros((h, w)); Q = np.zeros((h, w))
    P[:p.shape[0], :p.shape[1]] = p
    Q[:q.shape[0], :q.shape[1]] = q
    inter = (P * Q).sum(); union = ((P + Q) > 0).sum()
    return inter / union if union else 0.0

outlines = clusters(bright & img_zone, 150)
pieces = clusters(graydark & tray_zone, 300)
# exclude chip remnants: chips are navy; keep only clusters whose bbox aspect 0.3-2.5 and px>500 for pieces
pieces = [p for p in pieces if p['px'] > 600 and 0.25 < p['w'] / p['h'] < 2.8]

print(f'{len(outlines)} outlines, {len(pieces)} pieces')
targets = {}
for p in pieces:
    pn = norm(p['mask'])
    best, bi = -1, None
    for i, o in enumerate(outlines):
        s = iou(pn, norm(fill_outline(o['mask'])))
        if s > best:
            best, bi = s, i
    if bi is not None and best > 0.3:
        o = outlines[bi]
        dx, dy = o['cx'] - p['cx'], o['cy'] - p['cy']
        targets[p['cx']] = (round(p['cx']), round(p['cy']), round(o['cx']), round(o['cy']), round(best, 3))
        print(f"piece@({p['cx']:.0f},{p['cy']:.0f}) size {p['px']} -> outline@({o['cx']:.0f},{o['cy']:.0f}) IoU={best:.3f}  DRAG dx={dx:+.0f} dy={dy:+.0f}")
    else:
        print(f"piece@({p['cx']:.0f},{p['cy']:.0f}) size {p['px']} -> NO MATCH (best {best:.3f})")
