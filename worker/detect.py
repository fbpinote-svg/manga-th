"""comic-text-detector (ONNX): pixel text mask (EN/JP) -> text blocks by clustering, YOLO boxes only as language hints."""
import cv2, numpy as np
import sessions

INPUT = 1024
LANGS = ["en", "ja", "other"]          # detector classes: eng, ja (a third 'unknown' class exists in some exports)
# A mask component this large (fraction of the page) holding this little ink is
# a strip, not lettering — see regions_from_mask. Measured on real pages: real
# text blocks fill 39-88% of their box, the margin/gutter strips 16%.
SPRAWL_AREA = 0.02
SPRAWL_FILL = 0.25


def _pick_outputs(outs):
    blks = mask = None
    for o in outs:
        a = np.asarray(o)
        if a.ndim == 3 and a.shape[-1] >= 6:
            blks = a[0]
        elif a.ndim == 4 and a.shape[1] == 1:
            mask = a[0, 0]
    if blks is None or mask is None:
        raise RuntimeError(f"unexpected detector outputs: {[np.asarray(o).shape for o in outs]}")
    return blks, mask


def run(img_bgr, gpu: int, conf=0.4, iou=0.35, mask_th=0.3):
    """Returns (regions[{box, lang, vertical, score}], mask_u8 HxW). Very tall/wide pages (webtoons) are detected in tiles."""
    H, W = img_bgr.shape[:2]
    if max(H, W) > 2.2 * min(H, W):
        return _run_tiled(img_bgr, gpu, conf, iou, mask_th)
    return _run_single(img_bgr, gpu, conf, iou, mask_th)


def _run_tiled(img_bgr, gpu, conf, iou, mask_th, overlap=160):
    H, W = img_bgr.shape[:2]
    tile = max(min(H, W), 640)
    mask = np.zeros((H, W), np.uint8)
    hints = []
    if H >= W:
        starts = list(range(0, max(1, H - tile) + 1, tile - overlap))
        if starts[-1] + tile < H:
            starts.append(H - tile)
        for y0 in starts:
            y1 = min(H, y0 + tile)
            regs, m, h = _detect(img_bgr[y0:y1], gpu, conf, iou, mask_th)
            mask[y0:y1] = np.maximum(mask[y0:y1], m)
            hints += [([b[0], b[1] + y0, b[2], b[3]], l, s) for b, l, s in h]
    else:
        starts = list(range(0, max(1, W - tile) + 1, tile - overlap))
        if starts[-1] + tile < W:
            starts.append(W - tile)
        for x0 in starts:
            x1 = min(W, x0 + tile)
            regs, m, h = _detect(img_bgr[:, x0:x1], gpu, conf, iou, mask_th)
            mask[:, x0:x1] = np.maximum(mask[:, x0:x1], m)
            hints += [([b[0] + x0, b[1], b[2], b[3]], l, s) for b, l, s in h]
    return _finish(mask, hints, cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)), mask


def _run_single(img_bgr, gpu, conf, iou, mask_th):
    H, W = img_bgr.shape[:2]
    s = 2 if max(H, W) < 1000 else 1                  # small scans: detect at 2x so short words (はい!) are not lost
    src = cv2.resize(img_bgr, (W * s, H * s), interpolation=cv2.INTER_CUBIC) if s > 1 else img_bgr
    _, mask, hints = _detect(src, gpu, conf, iou, mask_th)
    if s > 1:
        mask = cv2.resize(mask, (W, H), interpolation=cv2.INTER_AREA)
        mask = ((mask > 127) * 255).astype(np.uint8)
        hints = [([int(v / s) for v in b], l, sc) for b, l, sc in hints]
    return _finish(mask, hints, cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)), mask


def _finish(mask_u8, hints, gray):
    regions = regions_from_mask(mask_u8, gray)
    for reg in regions:
        best, lang = 0.0, "other"
        for hb, hl, _ in hints:
            o = _overlap(reg["box"], hb)
            if o > best:
                best, lang = o, hl
        reg["lang"] = lang if best > 0.5 else "other"
    return regions


def _detect(img_bgr, gpu: int, conf, iou, mask_th):
    """One detector pass on an image (any size, letterboxed to 1024). Returns ([], mask_u8, hints[(box, lang, score)])."""
    H, W = img_bgr.shape[:2]
    r = INPUT / max(H, W)
    nw, nh = int(round(W * r)), int(round(H * r))
    pad = np.zeros((INPUT, INPUT, 3), np.uint8)
    pad[:nh, :nw] = cv2.resize(img_bgr, (nw, nh), interpolation=cv2.INTER_AREA if r < 1 else cv2.INTER_LINEAR)
    x = cv2.cvtColor(pad, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    s = sessions.get("ctd", gpu)
    blks, mask = _pick_outputs(s.run(None, {s.get_inputs()[0].name: x}))

    mh, mw = mask.shape
    m = mask[: int(nh * mh / INPUT), : int(nw * mw / INPUT)].astype(np.float32)
    if m.max() > 1.5:
        m /= 255.0
    m = cv2.resize(m, (W, H), interpolation=cv2.INTER_LINEAR)
    mask_u8 = ((m > mask_th) * 255).astype(np.uint8)

    # YOLO boxes -> language hints only
    nc = blks.shape[1] - 5
    cls = blks[:, 5:5 + nc]
    ci = cls.argmax(1)
    score = blks[:, 4] * cls[np.arange(len(blks)), ci]
    keep = score >= conf
    b, score, ci = blks[keep], score[keep], ci[keep]
    hints = []
    if len(b):
        xywh = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 2], b[:, 3]], 1) / r
        idx = np.array(cv2.dnn.NMSBoxes(xywh.tolist(), score.astype(float).tolist(), conf, iou)).reshape(-1)
        hints = [([int(v) for v in xywh[i]], LANGS[min(int(ci[i]), 2)], float(score[i])) for i in idx]
    return [], mask_u8, hints


def _overlap(a, b):
    """Fraction of box a covered by box b."""
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx)); iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    return ix * iy / float(aw * ah + 1e-6)


def _runs(profile, thresh):
    runs, n = [], 0
    for v in profile:
        if v > thresh:
            n += 1
        elif n:
            runs.append(n); n = 0
    if n:
        runs.append(n)
    return [r for r in runs if r >= 4]


def glyph_from_ink(ink, fallback):
    """Glyph size of a text block from its ink pixels: median run length of ink rows (line height of horizontal text)
    and of ink columns (column width of vertical text); the smaller of the two. Works for Latin words and CJK glyphs alike."""
    if ink.size == 0 or not ink.any():
        return int(fallback)
    rows = _runs(ink.mean(axis=1), 0.03)
    cols = _runs(ink.mean(axis=0), 0.03)
    cands = [float(np.median(r)) for r in (rows, cols) if r]
    return int(round(min(cands))) if cands else int(fallback)


def ink_mask(gray, mask, x, y, w, h):
    """Ink = mask pixels that differ strongly from the surrounding background (black-on-white and white-on-black both work)."""
    H, W = gray.shape
    x0, y0, x1, y1 = max(0, x - 4), max(0, y - 4), min(W, x + w + 4), min(H, y + h + 4)
    g = gray[y0:y1, x0:x1]
    m = mask[y0:y1, x0:x1] > 0
    ring = ~m
    bg = float(np.median(g[ring])) if ring.any() else 255.0
    return m & (np.abs(g.astype(np.int16) - bg) > 60)


def _glyph_size(gray, mask, x, y, w, h):
    return glyph_from_ink(ink_mask(gray, mask, x, y, w, h), min(w, h))


def regions_from_mask(mask_u8, gray=None, min_area=150):
    """Cluster mask components into text blocks.
    Each cluster keeps its bbox and the glyph sizes of its member components, so joins compare lettering size, not block
    size: words on a line / side-by-side columns (small horizontal gap) and stacked lines (small vertical gap + overlap)."""
    closed = cv2.morphologyEx(mask_u8, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(closed, 8)
    page = mask_u8.shape[0] * mask_u8.shape[1]
    cl = []
    for i in range(1, n):
        x, y, w, h = int(stats[i, 0]), int(stats[i, 1]), int(stats[i, 2]), int(stats[i, 3])
        ink = int(stats[i, cv2.CC_STAT_AREA])
        if ink < 12 or w < 3 or h < 3:
            continue
        # An L or a long thin strip — a page margin, a gutter, a side ad column
        # touching a footer banner — has a bounding box far bigger than its own
        # ink. Everything below works on bounding boxes, so leaving one in lets
        # it swallow every balloon that happens to sit inside that box: a whole
        # page of dialogue collapses into a single region, the balloons render
        # empty and their merged text is painted across the artwork. Real
        # lettering fills a good third of its box even at its sparsest.
        if w * h >= SPRAWL_AREA * page and ink < SPRAWL_FILL * w * h:
            continue
        gs = _glyph_size(gray, closed, x, y, w, h) if gray is not None else int(min(w, h))
        cl.append({"box": [x, y, w, h], "hs": [gs]})
    changed = True
    while changed:
        changed = False
        for i in range(len(cl)):
            for j in range(i + 1, len(cl)):
                if _should_join(cl[i], cl[j]):
                    a, b = cl[i]["box"], cl[j]["box"]
                    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
                    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
                    cl[i] = {"box": [x0, y0, x1 - x0, y1 - y0], "hs": cl[i]["hs"] + cl[j]["hs"]}
                    cl.pop(j)
                    changed = True
                    break
            if changed:
                break
    boxes = [c["box"] for c in cl]
    changed = True                                    # final pass: blocks that overlap each other are one block
    while changed:
        changed = False
        for i in range(len(boxes)):
            for j in range(i + 1, len(boxes)):
                a, b = boxes[i], boxes[j]
                if _iou(a, b) > 0.15 or _overlap(a, b) > 0.6 or _overlap(b, a) > 0.6:
                    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
                    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
                    boxes[i] = [x0, y0, x1 - x0, y1 - y0]
                    boxes.pop(j)
                    changed = True
                    break
            if changed:
                break
    out = []
    for x, y, w, h in boxes:
        if w * h < min_area or min(w, h) < 8:             # drop specks / broken strokes
            continue
        out.append({"box": [x, y, w, h], "lang": "other", "vertical": h > 1.6 * w, "score": 1.0})
    return out


def _iou(a, b):
    ax, ay, aw, ah = a; bx, by, bw, bh = b
    ix = max(0, min(ax + aw, bx + bw) - max(ax, bx)); iy = max(0, min(ay + ah, by + bh) - max(ay, by))
    inter = ix * iy
    return inter / float(aw * ah + bw * bh - inter + 1e-6)


def _line_h(c):
    hs = sorted(h for h in c["hs"] if h >= 4) or c["hs"]
    return float(hs[len(hs) // 2])


def _should_join(a, b):
    ax, ay, aw, ah = a["box"]; bx, by, bw, bh = b["box"]
    la, lb = _line_h(a), _line_h(b)
    lmin, lmax = min(la, lb), max(la, lb)
    if lmax > 2.5 * lmin and lmin >= 10:              # clearly different lettering sizes (dialogue vs big SFX) never belong together
        return False
    gx = max(ax, bx) - min(ax + aw, bx + bw)          # horizontal gap (negative = overlap)
    gy = max(ay, by) - min(ay + ah, by + bh)          # vertical gap (negative = overlap)
    if gx <= 0.8 * lmin and gy <= -0.4 * lmin:        # same line (or side-by-side vertical columns): strong vertical overlap
        # ...but words on one line, and columns beside each other, run the same
        # length. A block many times taller than the other is not its neighbour,
        # it is a box the other one merely happens to sit inside.
        return max(ah, bh) <= 3.0 * max(1, min(ah, bh))
    ox = -gx                                          # horizontal overlap
    if gy <= 1.0 * lmax and ox >= 0.3 * float(min(aw, bw)):  # stacked lines (Japanese leading + furigana can be a full line)
        # Consecutive lines sit under one another: they touch, or nearly. One
        # engulfed in the other's vertical span is a containment, not a stack —
        # which is how a single oversized block used to absorb a whole page.
        return gy >= -1.0 * lmax
    return False


def order(regions):
    """Assign ids b1..bn in reading order: rows top→bottom, left→right (right→left when most blocks are vertical, i.e. Japanese)."""
    n = len(regions)
    rtl = n > 0 and sum(bool(r["vertical"]) for r in regions) * 2 > n
    rows = []
    for r in sorted(regions, key=lambda r: r["box"][1] + r["box"][3] / 2):
        x, y, w, h = r["box"]
        for row in rows:
            ov = min(row["y2"], y + h) - max(row["y1"], y)
            if ov >= 0.5 * min(h, row["h"]):
                row["items"].append(r); row["y1"] = min(row["y1"], y); row["y2"] = max(row["y2"], y + h); row["h"] = min(row["h"], h)
                break
        else:
            rows.append({"y1": y, "y2": y + h, "h": h, "items": [r]})
    rows.sort(key=lambda row: row["y1"])
    out = []
    for row in rows:
        out += sorted(row["items"], key=lambda r: r["box"][0] + r["box"][2] / 2, reverse=rtl)
    for i, r in enumerate(out):
        r["id"] = f"b{i + 1}"
    return out, rtl
