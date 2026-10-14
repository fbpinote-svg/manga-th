"""Text cleaning: bubble interior via flood-fill, detector+luminance mask, flat fill or LaMa (512 crops), ghost check."""
import base64
import cv2, numpy as np
import sessions, detect

LAMA = 512


def png_b64(img) -> str:
    return base64.b64encode(cv2.imencode(".png", img)[1].tobytes()).decode()


def is_oom(e: Exception) -> bool:
    s = str(e).lower()
    return "memory" in s or "cudaerrormemoryallocation" in s


def ellipse(k):
    k = max(1, int(k)) | 1
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))


def clamp_box(box, W, H):
    x, y, w, h = [int(round(float(v))) for v in box]
    x = max(0, min(x, W - 1)); y = max(0, min(y, H - 1))
    return x, y, max(1, min(w, W - x)), max(1, min(h, H - y))


# A balloon sits around its lettering: the room it leaves on one side is close
# to the room on the other. Past this much lopsidedness on an axis, the long
# side is treated as fill that ran somewhere it should not have, and both sides
# are pulled back to the short one. Balanced bubbles (most of them) are left
# exactly as they are.
LOPSIDED = 1.5


def bubble_interior(gray, det_mask, box, vertical=False):
    """Flood-fill the bright region around a text box (detected text strokes act as barriers, so SFX crossing the outline cannot leak).
    Returns (frame, interior HxW uint8, ellipse, ib) or None when the text is not inside a closed bubble.
    frame = the whole bright region when it is bubble-sized (<= 12x the text box), else clamped to the grown text box
    (page background / huge joined regions stay local); ellipse = frame is the whole interior; ib = interior bbox (x0, y0, x1, y1)."""
    H, W = gray.shape
    x, y, w, h = box
    ex, ey = min(3 * w, 600), min(3 * h, 600)
    rx0, ry0 = max(0, x - ex), max(0, y - ey)
    rx1, ry1 = min(W, x + w + ex), min(H, y + h + ey)
    roi = gray[ry0:ry1, rx0:rx1].copy()                 # copy: never write barriers into the shared gray image
    roi[cv2.dilate(det_mask[ry0:ry1, rx0:rx1], ellipse(5)) > 0] = 0
    rh, rw = roi.shape
    ff = np.zeros((rh + 2, rw + 2), np.uint8)
    def seed_grid(pad):
        pts = [
            (int(sx) - rx0, int(sy) - ry0)
            for sy in np.linspace(y + 1 - pad, y + h - 2 + pad, 7)
            for sx in np.linspace(x + 1 - pad, x + w - 2 + pad, 7)
        ]
        return [s for s in pts if 0 <= s[0] < rw and 0 <= s[1] < rh and roi[s[1], s[0]] >= 200]

    seeds = seed_grid(0)
    if not seeds:
        # A small box whose lettering fills it has no bright pixel left to start
        # from: every seed lands on a stroke that was just painted in as a
        # barrier. The balloon around it would be missed entirely and the text
        # laid out in the bare text box — a word rendered tiny in the corner of
        # a balloon it should fill. Look just outside the box for the balloon's
        # own white before giving up; the coverage test below still throws out
        # anything that turns out not to enclose the text.
        seeds = seed_grid(max(3, int(round(0.5 * h))))
    if not seeds:
        return None
    flags = 4 | cv2.FLOODFILL_MASK_ONLY | cv2.FLOODFILL_FIXED_RANGE | (255 << 8)
    for sx, sy in seeds[:10]:
        if ff[sy + 1, sx + 1]:
            continue
        # Tolerance ±25 was generous enough to leak through a soft/light-grey shading
        # transition (a plant, a shadow) into a lightly-toned panel background when the
        # bubble itself is an "open" radiating burst/flash effect with no closed ink
        # outline to stop at — the flood then filled a much bigger area than the real
        # white burst, and text got centred/placed partly over that art. ±18 still
        # comfortably covers scan noise and JPEG ringing inside a genuinely flat white
        # or screentone bubble, while stopping sooner at a soft art transition.
        cv2.floodFill(roi, ff, (sx, sy), 0, 18, 18, flags)
    region = ff[1:-1, 1:-1]
    ys, xs = np.nonzero(region)
    if len(xs) == 0:
        return None
    bx0, bx1, by0, by1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    # inside the text box every pixel must be bright background or a (dilated) text stroke; otherwise the text sits over art
    reg_box = region[y - ry0:y - ry0 + h, x - rx0:x - rx0 + w] > 0
    strokes_box = cv2.dilate(det_mask[y:y + h, x:x + w], ellipse(5)) > 0
    if reg_box.size == 0 or float((reg_box | strokes_box).mean()) < 0.9:
        return None
    # ...and the fill has to have reached the box, not merely failed to conflict
    # with it. In a small box the dilated strokes alone cover well over 90%, so
    # the test above passes on their own and would accept a bright blob found
    # somewhere else in the ROI — which then yields a frame that does not even
    # contain the text.
    if not reg_box.any():
        return None
    full = np.zeros((H, W), np.uint8)
    full[ry0:ry1, rx0:rx1] = region
    ib = (int(rx0 + bx0), int(ry0 + by0), int(rx0 + bx1), int(ry0 + by1))    # whole bright region (x0, y0, x1, y1)
    if (ib[2] - ib[0]) * (ib[3] - ib[1]) <= 12 * w * h:
        # A bubble: lay the text out in the whole bubble — but only as far out as
        # the source lettering can vouch for.
        #
        # When a bubble has no closed outline (a radiating burst) or its white
        # runs straight into white artwork, the fill slips out and keeps going:
        # into a character's face, or across a panel's bright background. The
        # "interior" then reaches far past the lettering on that side, the text
        # gets centred out there, and the balloon itself is left empty.
        # Nothing about the escaped fill gives it away — its area, how much of
        # its box it fills, how convex it is, how much dark ink walls it in, and
        # how lopsided it sits around the text were all measured against real
        # bubbles and every one of them overlaps completely. What does hold is
        # the source text: the translation belongs where the original stood.
        # So where one side of the interior runs far past the lettering and the
        # other does not, the long side comes back to match the short one.
        # Margins are floored at zero: an interior can start inside the text box
        # (the box overhangs the balloon a little), and a negative margin here
        # would invert the frame into a negative width.
        ml, mr = max(0, x - ib[0]), max(0, ib[2] - (x + w))
        mt, mb = max(0, y - ib[1]), max(0, ib[3] - (y + h))
        mx = min(ml, mr) if max(ml, mr) > LOPSIDED * max(1, min(ml, mr)) else None
        my = min(mt, mb) if max(mt, mb) > LOPSIDED * max(1, min(mt, mb)) else None
        fx0, fx1 = (x - mx, x + w + mx) if mx is not None else (ib[0], ib[2])
        fy0, fy1 = (y - my, y + h + my) if my is not None else (ib[1], ib[3])
        # Never hand back something the text cannot be laid out in.
        fx0, fx1 = min(fx0, fx1), max(fx0, fx1)
        fy0, fy1 = min(fy0, fy1), max(fy0, fy1)
        if fx1 - fx0 < 2 or fy1 - fy0 < 2:
            fx0, fy0, fx1, fy1 = ib
        whole = (fx0, fy0, fx1, fy1) == ib
        return (fx0, fy0, fx1 - fx0, fy1 - fy0), full, whole, ib
    # huge bright region (page background, joined bubbles far larger than the text): stay near the text box
    gw, gh = (2.0 if vertical else 0.8) * w, 0.5 * h
    gx0, gy0 = max(0, int(x - gw)), max(0, int(y - gh))
    gx1, gy1 = min(W, int(x + w + gw)), min(H, int(y + h + gh))
    sy, sx = np.nonzero(full[gy0:gy1, gx0:gx1])
    frame = (int(gx0 + sx.min()), int(gy0 + sy.min()), int(sx.max() - sx.min() + 1), int(sy.max() - sy.min() + 1))
    return frame, full, False, ib


def ring_stats(img, gray, box, t=6):
    """Median gray, median BGR colour and bright fraction of a t-px ring around the box."""
    H, W = gray.shape
    x, y, w, h = box
    x0, y0, x1, y1 = max(0, x - t), max(0, y - t), min(W, x + w + t), min(H, y + h + t)
    ring = np.ones((y1 - y0, x1 - x0), bool)
    ring[y - y0:y - y0 + h, x - x0:x - x0 + w] = False
    g = gray[y0:y1, x0:x1][ring]
    if g.size == 0:
        return 255, np.array([255, 255, 255], np.uint8), 0.0
    c = np.median(img[y0:y1, x0:x1][ring], axis=0).astype(np.uint8)
    return int(np.median(g)), c, float((g > 230).mean())


def line_height(strokes, fallback):
    """Typical glyph size of a text block from its stroke pixels (row/column run lengths; see detect.glyph_from_ink)."""
    return float(detect.glyph_from_ink(np.asarray(strokes, bool), fallback))


def region_mask(gray, det_mask, box, kind, ref_gray):
    """Full-size uint8 mask of the text strokes in one region, dilated by text height. Returns (mask, textH)."""
    H, W = gray.shape
    x, y, w, h = box
    pad = 48
    x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
    local = np.zeros((y1 - y0, x1 - x0), np.uint8)
    bx0, by0 = max(0, x - 4) - x0, max(0, y - 4) - y0
    bx1, by1 = min(W, x + w + 4) - x0, min(H, y + h + 4) - y0
    det = det_mask[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1] > 0
    g = gray[y0 + by0:y0 + by1, x0 + bx0:x0 + bx1].astype(np.int16)
    lum = (g < ref_gray - 25) | ((g > ref_gray + 25) if ref_gray <= 235 else False)   # dark ink, or light chalk on a grey board
    m = det | lum if kind == "bubble" else det
    local[by0:by1, bx0:bx1] = m.astype(np.uint8) * 255
    local = cv2.morphologyEx(local, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    textH = line_height(lum if kind == "bubble" else det, h)          # window = text box + 4 px margin
    k = int(np.clip(round(0.15 * textH), 5, 21)) if kind == "bubble" else int(np.clip(round(0.30 * textH), 7, 41))
    local = cv2.dilate(local, ellipse(k))
    full = np.zeros((H, W), np.uint8)
    full[y0:y1, x0:x1] = local
    return full, textH


def lama_fill(img, mask, gpu):
    """Inpaint img in place where mask>0 with LaMa on a 512 window at native resolution (scaled only when the hole is larger)."""
    H, W = img.shape[:2]
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return
    bh, bw = int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)
    S = int(max(LAMA, bh + 64, bw + 64))
    cy, cx = int((ys.min() + ys.max()) // 2), int((xs.min() + xs.max()) // 2)
    y0 = int(np.clip(cy - S // 2, 0, max(0, H - S))); x0 = int(np.clip(cx - S // 2, 0, max(0, W - S)))
    crop = img[y0:y0 + S, x0:x0 + S]; mcrop = mask[y0:y0 + S, x0:x0 + S]
    ph, pw = S - crop.shape[0], S - crop.shape[1]
    if ph or pw:
        crop = cv2.copyMakeBorder(crop, 0, ph, 0, pw, cv2.BORDER_REFLECT)
        mcrop = cv2.copyMakeBorder(mcrop, 0, ph, 0, pw, cv2.BORDER_CONSTANT, value=0)
    cin = crop if S == LAMA else cv2.resize(crop, (LAMA, LAMA), interpolation=cv2.INTER_AREA)
    mi = mcrop if S == LAMA else cv2.resize(mcrop, (LAMA, LAMA), interpolation=cv2.INTER_NEAREST)
    s = sessions.get("lama", gpu)
    names = [i.name for i in s.get_inputs()]
    x = cv2.cvtColor(cin, cv2.COLOR_BGR2RGB).transpose(2, 0, 1)[None].astype(np.float32) / 255.0
    mm = (mi > 0).astype(np.float32)[None, None]
    out = s.run(None, {names[0]: x, names[1]: mm})[0][0].transpose(1, 2, 0)
    if out.max() <= 1.5:                      # some exports return 0..1
        out = out * 255.0
    out = cv2.cvtColor(np.clip(out, 0, 255).astype(np.uint8), cv2.COLOR_RGB2BGR)
    if S != LAMA:
        out = cv2.resize(out, (S, S), interpolation=cv2.INTER_CUBIC)
    a = cv2.GaussianBlur(cv2.dilate(mcrop, ellipse(7)), (9, 9), 0).astype(np.float32)[..., None] / 255.0
    res = (out * a + crop * (1 - a)).astype(np.uint8)
    img[y0:y0 + S - ph, x0:x0 + S - pw] = res[:S - ph, :S - pw]


def _iou_xyxy(a, b):
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0])); iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    return inter / float((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter + 1e-6)


def _separated(gray, wide, ca, cb):
    """True when dark non-text pixels (a bubble outline or panel border) lie on the segment between two box centres.
    `wide` = text mask dilated generously, so ink and punctuation next to the text are ignored."""
    n = int(max(abs(cb[0] - ca[0]), abs(cb[1] - ca[1]))) + 1
    dark = 0
    for t in np.linspace(0.0, 1.0, n):
        x, y = int(round(ca[0] + (cb[0] - ca[0]) * t)), int(round(ca[1] + (cb[1] - ca[1]) * t))
        if 0 <= y < gray.shape[0] and 0 <= x < gray.shape[1] and gray[y, x] < 100 and not wide[y, x]:
            dark += 1
            if dark >= 3:
                return True
    return False


def merge_same_bubble(regions, gray, det_mask):
    """Fragments of one bubble's text (furigana lines, side-by-side vertical columns, a lone 'あっ') become one region.
    Joined bubbles stay apart: the union box of their texts crosses the neck, so it is not fully bright interior."""
    H, W = gray.shape
    strokes = cv2.dilate(det_mask, ellipse(5)) > 0
    wide = cv2.dilate(det_mask, ellipse(13)) > 0
    inter, glyph = {}, {}
    for r in regions:
        x, y, w, h = clamp_box(r["box"], W, H)
        res = bubble_interior(gray, det_mask, (x, y, w, h), r.get("vertical", False))
        inter[r["id"]] = (res[1], res[3]) if res else None
        glyph[r["id"]] = detect.glyph_from_ink(detect.ink_mask(gray, det_mask, x, y, w, h), min(w, h))   # from ink, not the blobby mask
    changed = True
    while changed:
        changed = False
        for i in range(len(regions)):
            for j in range(i + 1, len(regions)):
                a, b = regions[i], regions[j]
                ia, ib = inter.get(a["id"]), inter.get(b["id"])
                if not ia or not ib or _iou_xyxy(ia[1], ib[1]) < 0.6:
                    continue
                ax, ay, aw, ah = a["box"]; bx, by, bw, bh = b["box"]
                gap = max(0, max(ax, bx) - min(ax + aw, bx + bw), max(ay, by) - min(ay + ah, by + bh))
                if gap > 1.5 * max(glyph[a["id"]], glyph[b["id"]]) + 2:
                    continue                                  # lines/columns of one text sit within ~1.5 glyphs; other bubbles' text is farther
                if _separated(gray, wide, (ax + aw / 2, ay + ah / 2), (bx + bw / 2, by + bh / 2)):
                    continue                                  # an outline (joined bubbles, panel border) runs between them
                ux0, uy0, ux1, uy1 = min(ax, bx), min(ay, by), max(ax + aw, bx + bw), max(ay + ah, by + bh)
                cover = (ia[0][uy0:uy1, ux0:ux1] > 0) | strokes[uy0:uy1, ux0:ux1]
                if cover.size == 0 or float(cover.mean()) < 0.92:
                    continue
                a["box"] = [ux0, uy0, ux1 - ux0, uy1 - uy0]
                a["vertical"] = bool(a.get("vertical") or b.get("vertical"))
                if a.get("lang") == "other":
                    a["lang"] = b.get("lang", "other")
                regions.pop(j)
                changed = True
                break
            if changed:
                break
    return regions


def trim_frames(regions, bubbles):
    """Cut a layout frame back so it never covers another region's text box (joined bubbles, stacked captions)."""
    for r in regions:
        f = bubbles.get(r["id"])
        if not f:
            continue
        fx0, fy0, fx1, fy1 = f[0], f[1], f[0] + f[2], f[1] + f[3]
        x, y, w, h = r["box"]
        for o in regions:
            if o is r:
                continue
            ox, oy, ow, oh = o["box"]
            if ox >= fx1 or ox + ow <= fx0 or oy >= fy1 or oy + oh <= fy0:
                continue                                  # no overlap with this frame
            if ox >= x + w:
                fx1 = min(fx1, ox - 2)
            elif ox + ow <= x:
                fx0 = max(fx0, ox + ow + 2)
            elif oy >= y + h:
                fy1 = min(fy1, oy - 2)
            elif oy + oh <= y:
                fy0 = max(fy0, oy + oh + 2)
        if fx0 <= x and fy0 <= y and fx1 >= x + w and fy1 >= y + h:
            bubbles[r["id"]] = [int(fx0), int(fy0), int(fx1 - fx0), int(fy1 - fy0)]
    # frames must never overlap each other (joined bubbles share one interior): split at the midpoint between the two text boxes
    by_id = {r["id"]: r for r in regions}
    ids = [i for i in bubbles if i in by_id]
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            a, b = bubbles[ids[i]], bubbles[ids[j]]
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            if ox <= 0 or oy <= 0:
                continue
            ra, rb = by_id[ids[i]]["box"], by_id[ids[j]]["box"]
            sep_x = ra[0] >= rb[0] + rb[2] or rb[0] >= ra[0] + ra[2]
            sep_y = ra[1] >= rb[1] + rb[3] or rb[1] >= ra[1] + ra[3]
            if sep_x and (not sep_y or ox <= oy):
                left, right = (a, b) if ra[0] < rb[0] else (b, a)
                lb, rb_ = (ra, rb) if ra[0] < rb[0] else (rb, ra)
                mid = (lb[0] + lb[2] + rb_[0]) // 2
                left[2] = max(lb[0] + lb[2], mid - 2) - left[0]
                nx = min(rb_[0], mid + 2); right[2] = right[0] + right[2] - nx; right[0] = nx
            elif sep_y:
                top, bottom = (a, b) if ra[1] < rb[1] else (b, a)
                tb, bb = (ra, rb) if ra[1] < rb[1] else (rb, ra)
                mid = (tb[1] + tb[3] + bb[1]) // 2
                top[3] = max(tb[1] + tb[3], mid - 2) - top[1]
                ny = min(bb[1], mid + 2); bottom[3] = bottom[1] + bottom[3] - ny; bottom[1] = ny


def row_profiles(bubbles, closed_by_id, K=32):
    """For each frame: usable [left, right] (frame-relative) of the bubble interior on K evenly spaced rows => shaped text layout."""
    out = {}
    for rid, f in bubbles.items():
        m = closed_by_id.get(rid)
        if m is None:
            continue
        x, y, w, h = f
        rows = []
        for k in range(K):
            yy = min(y + h - 1, y + int((k + 0.5) * h / K))
            xs = np.nonzero(m[yy, x:x + w])[0]
            rows.append([int(xs.min()), int(xs.max()) + 1] if len(xs) else [0, 0])
        out[rid] = rows
    return out


def ghost(out_gray, mask, ref_gray):
    inner = cv2.erode(mask, ellipse(9)) > 0
    n = int(inner.sum())
    return n > 0 and int(((out_gray < ref_gray - 20) & inner).sum()) > 0.005 * n


def clean_page(img, gpu: int, regions=None, lama_all=False) -> dict:
    H, W = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    det_regions, det_mask = detect.run(img, gpu)
    if regions is None:
        # page furniture (series title / running head at the very top, page number at the very bottom) is left untouched
        det_regions = [r for r in det_regions if 0.05 * H <= r["box"][1] + r["box"][3] / 2 <= 0.96 * H]
        merged = merge_same_bubble([dict(r, id=f"t{i}") for i, r in enumerate(det_regions)], gray, det_mask)
        ordered, _ = detect.order(merged)
        regions = [{"id": r["id"], "kind": "free", "box": r["box"], "vertical": r["vertical"], "lang": r["lang"], "inpaint": "auto"} for r in ordered]
    out = img.copy()
    full_mask = np.zeros((H, W), np.uint8)
    bubbles, used, warnings, closed_by_id = {}, {}, [], {}
    for r in regions:
        box = clamp_box(r["box"], W, H)
        r["box"] = list(box)
        inter = bubble_interior(gray, det_mask, box, r.get("vertical", False))
        kind = "bubble" if inter else "free"
        r["kind"] = kind
        r["ellipse"] = bool(inter and inter[2])
        flat = False
        if inter:
            frame, interior, _, _ = inter
            bubbles[r["id"]] = list(frame)
            sel = interior > 0
            vals = gray[sel]
            ref_gray, color, bright = int(np.median(vals)), np.median(img[sel], axis=0).astype(np.uint8), float((vals > 230).mean())
            flat = float(vals.std()) <= 8.0          # uniform grey (blackboard, tinted bubble): a flat fill beats inpainting
        else:
            ref_gray, color, bright = ring_stats(img, gray, box)
        m, textH = region_mask(gray, det_mask, box, kind, ref_gray)
        r["text_h"] = int(round(textH))
        r["bg_gray"] = int(ref_gray)
        closed = None
        if inter:
            # interior has holes where the text strokes were barriers: add the strokes back, then close small gaps.
            # The bubble outline is in neither set, so painting stays inside the bubble.
            x, y, w, h = box
            strokes = np.zeros_like(det_mask)
            strokes[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4] = det_mask[max(0, y - 4):y + h + 4, max(0, x - 4):x + w + 4]
            # Capped like region_mask()'s own dilation kernel: an overestimated textH (common on
            # bold/large SFX-style lettering, e.g. a big shout in a jagged burst bubble) must not
            # turn into a runaway closing radius that bridges past the bubble's real points into
            # background — that is what painted a big flat rectangle outside a star-shaped bubble.
            closed = cv2.morphologyEx(cv2.bitwise_or(interior, strokes), cv2.MORPH_CLOSE, ellipse(min(2 * textH + 1, 61)))
            closed_by_id[r["id"]] = closed
            m = cv2.bitwise_and(m, closed)
        # "Inpaint everything" has to mean everything with texture worth rebuilding.
        # A bubble whose flood-filled interior is uniform gives LaMa nothing to
        # reconstruct from, and it answers with a faint mottled echo of the very
        # lettering it was asked to remove — measured on one balloon band of
        # chapter 8 page 18: the flat fill leaves 272 px below level 250 and none
        # below 230, LaMa leaves 1707 and 137 (down to 28). That echo is the ghost
        # readers see sitting behind the Thai. An explicit per-region "lama" still
        # wins, so a caller can always force it.
        want_lama = (lama_all and not flat) or r.get("inpaint") == "lama"
        if not want_lama and (bright >= 0.9 or flat or r.get("inpaint") == "fill"):
            out[m > 0] = color
            used[r["id"]] = "fill"
            if ghost(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), m, ref_gray):
                m2 = cv2.dilate(m, ellipse(9))
                if closed is not None:
                    m2 = cv2.bitwise_and(m2, closed)
                out[m2 > 0] = color
                m = m2
                if ghost(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), m, ref_gray):
                    warnings.append(f"{r['id']}: residual text after fill")
        else:
            try:
                lama_fill(out, m, gpu)
                used[r["id"]] = "lama"
            except Exception as e:
                if not is_oom(e):
                    raise
                out[m > 0] = color
                used[r["id"]] = "fill"
                warnings.append(f"{r['id']}: GPU {gpu} out of memory, used flat fill")
        full_mask = cv2.bitwise_or(full_mask, m)
    trim_frames(regions, bubbles)
    return {
        "w": W, "h": H, "regions": regions, "bubbles": bubbles, "profiles": row_profiles(bubbles, closed_by_id), "order": [r["id"] for r in regions],
        "clean_png_b64": png_b64(out), "mask_png_b64": png_b64(full_mask), "inpaint_used": used, "warnings": warnings,
    }
