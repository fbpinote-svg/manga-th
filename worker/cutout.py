"""Character cutout with ISNet-anime (rembg isnet-anime weights) -> RGBA PNG bytes."""
import cv2, numpy as np
import sessions

SIZE = 1024
MEAN = np.array([0.485, 0.456, 0.406], np.float32)      # rembg/sessions/dis_anime.py (std 1.0)


def cutout(img_bgr, gpu: int, rect=None) -> bytes:
    H, W = img_bgr.shape[:2]
    x, y, w, h = [int(v) for v in (rect or (0, 0, W, H))]
    x, y = max(0, min(x, W - 1)), max(0, min(y, H - 1))
    w, h = max(1, min(w, W - x)), max(1, min(h, H - y))
    crop = img_bgr[y:y + h, x:x + w]
    rgb = cv2.cvtColor(cv2.resize(crop, (SIZE, SIZE), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2RGB).astype(np.float32)
    rgb = rgb / max(1.0, float(rgb.max())) - MEAN
    s = sessions.get("isnet", gpu)
    pred = s.run(None, {s.get_inputs()[0].name: rgb.transpose(2, 0, 1)[None]})[0][0, 0]
    pred = (pred - pred.min()) / (pred.max() - pred.min() + 1e-6)
    alpha = cv2.resize((pred * 255).astype(np.uint8), (w, h), interpolation=cv2.INTER_LINEAR)
    rgba = cv2.cvtColor(crop, cv2.COLOR_BGR2BGRA)
    rgba[..., 3] = alpha
    return cv2.imencode(".png", rgba)[1].tobytes()
