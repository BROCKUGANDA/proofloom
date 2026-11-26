"""Detect overlay lines in hCaptcha challenge images and rank by arc length.
Usage: python3 line_solve.py /tmp/screenshot.png
Prints each detected line: color name, arc length (orig px), midpoint (viewport coords)."""
import sys
import cv2
import numpy as np

path = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ch.png'
img = cv2.imread(path)  # BGR
H, W = img.shape[:2]
# challenge image region (observed layout)
y0, y1, x0, x1 = 143, 460, 510, 1002
sub = img[y0:y1, x0:x1]

hsv = cv2.cvtColor(sub, cv2.COLOR_BGR2HSV).astype(int)
Hh, S, V = hsv[..., 0], hsv[..., 1], hsv[..., 2]

# Overlay lines: pale/saturated colors distinct from photo.
# Photo: dark greens (H 35-85 in OpenCV 0-180 scale), dark blues, grays.
# Lines: cream (H~20-35, S 40-140, V>150), tan/brown (H 5-25, S 60-160), teal (H 80-100, S 40-120, V>120),
#        red (H<10 or >170, S>80), orange (H 10-25, S>120), pink...
# Strategy: V > 130 OR (S > 90 and V > 100), exclude strong green hues of foliage (H 35-90 with S>120 & V<150)
cand = ((V > 135) & (S > 35)) | ((S > 100) & (V > 110))
# foliage mask: green hues, high texture — exclude
foliage = ((Hh >= 30) & (Hh <= 95) & (S > 110) & (V < 160))
cand = cand & ~foliage

mask = cand.astype(np.uint8) * 255
# clean
kern = np.ones((3, 3), np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kern)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

n, lbl, stats, cent = cv2.connectedComponentsWithStats(mask, 8)
print('components:', n - 1)

def arc_length(comp_mask):
    # skeleton via thinning approx: use cv2.ximgproc if available else distance-transform ridge
    try:
        th = cv2.ximgproc.thinning(comp_mask)
    except Exception:
        # fallback: erode-based skeleton
        th = cv2.morphologyEx(comp_mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
        sk = np.zeros_like(th)
        el = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        tmp = th.copy()
        while True:
            er = cv2.erode(tmp, el)
            op = cv2.dilate(er, el)
            sk |= cv2.subtract(tmp, op)
            tmp = er
            if cv2.countNonZero(tmp) == 0:
                break
        th = sk
    ys, xs = np.where(th > 0)
    return len(ys)  # pixel count of skeleton ~ arc length

results = []
for i in range(1, n):
    m = (lbl == i).astype(np.uint8)
    px = int(m.sum())
    if px < 150:
        continue
    x, y, w, h, area = stats[i]
    L = arc_length(m * 255)
    # endpoint distance: farthest pair among skeleton points (approx: use PCA extremes)
    sk = None
    try:
        sk = cv2.ximgproc.thinning(m * 255)
    except Exception:
        sk = m * 255
    pys, pxs = np.where(sk > 0)
    if len(pxs) > 4:
        pts = np.column_stack([pxs, pys]).astype(float)
        c0 = pts.mean(axis=0)
        d = np.linalg.norm(pts - c0, axis=1)
        a = pts[np.argmax(d)]
        d2 = np.linalg.norm(pts - a, axis=1)
        bb = pts[np.argmax(d2)]
        span = float(np.linalg.norm(a - bb))
    else:
        span = 0.0
    # mean color for identification
    sel = sub[m > 0]
    bmn, gmn, rmn = sel[:, 0].mean(), sel[:, 1].mean(), sel[:, 2].mean()
    hsvm = cv2.cvtColor(np.uint8([[[int(bmn), int(gmn), int(rmn)]]]), cv2.COLOR_BGR2HSV)[0, 0]
    results.append((L, span, (x + w / 2 + x0, y + h / 2 + y0), px, (rmn, gmn, bmn), (int(hsvm[0]), int(hsvm[1]), int(hsvm[2])), w, h))

results.sort()
print(f'{"arclen":>7} {"span":>6} {"mid(x,y)":>16} {"px":>6} {"RGB":>16} {"HSV":>12} {"w":>4} {"h":>4}')
for L, span, mid, px, rgb, hsvm, w, h in results:
    print(f'{L:7d} {span:6.0f} ({mid[0]:6.0f},{mid[1]:6.0f}) {px:6d} ({rgb[0]:3.0f},{rgb[1]:3.0f},{rgb[2]:3.0f}) ({hsvm[0]:3d},{hsvm[1]:3d},{hsvm[2]:3d}) {w:4d} {h:4d}')
