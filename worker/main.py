"""FastAPI GPU worker: /health /gpus /clean /cutout. One job per GPU (threading.Lock); sync endpoints keep /gpus responsive."""
import json, threading, time
from contextlib import asynccontextmanager
from typing import Literal

import cv2, numpy as np, pynvml
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

import sessions, clean, cutout

GPU_LOCKS: dict[int, threading.Lock] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    pynvml.nvmlInit()
    for i in range(pynvml.nvmlDeviceGetCount()):
        GPU_LOCKS[i] = threading.Lock()
    yield
    pynvml.nvmlShutdown()


app = FastAPI(title="manga-gpu-worker", lifespan=lifespan)


class Region(BaseModel):
    id: str
    kind: Literal["bubble", "free"] = "free"
    box: tuple[int, int, int, int]
    vertical: bool = False
    lang: Literal["en", "ja", "other"] = "other"
    inpaint: Literal["auto", "fill", "lama"] = "auto"
    ellipse: bool = False           # frame is a whole bubble interior -> inscribed-ellipse text fitting
    text_h: int = 0                 # glyph height of the original lettering (px), caps the Thai font size
    bg_gray: int = 255              # background brightness under the text; the UI adds a white outline when it is not white


class CleanOut(BaseModel):
    w: int
    h: int
    regions: list[Region]
    bubbles: dict[str, tuple[int, int, int, int]]
    profiles: dict[str, list[list[int]]] = {}
    order: list[str]
    clean_png_b64: str
    mask_png_b64: str
    inpaint_used: dict[str, Literal["fill", "lama"]]
    warnings: list[str]


def _gpu(gpu: int) -> int:
    if gpu not in GPU_LOCKS:
        raise HTTPException(400, f"gpu must be one of {sorted(GPU_LOCKS)}")
    return gpu


def _image(upload: UploadFile) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(upload.file.read(), np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "cannot decode image")
    return img


@app.get("/health")
def health():
    return {"ok": True, "providers": sessions.providers(), "gpus": len(GPU_LOCKS), "loaded": sessions.loaded()}


@app.get("/gpus")
def gpus():
    out = []
    for i in range(pynvml.nvmlDeviceGetCount()):
        h = pynvml.nvmlDeviceGetHandleByIndex(i)
        u = pynvml.nvmlDeviceGetUtilizationRates(h)
        m = pynvml.nvmlDeviceGetMemoryInfo(h)
        out.append({"index": i, "name": pynvml.nvmlDeviceGetName(h), "util": int(u.gpu), "mem_used_mb": int(m.used >> 20),
                    "mem_total_mb": int(m.total >> 20), "temp": int(pynvml.nvmlDeviceGetTemperature(h, pynvml.NVML_TEMPERATURE_GPU)),
                    "busy": GPU_LOCKS[i].locked()})
    return out


@app.post("/clean", response_model=CleanOut)
def clean_ep(image: UploadFile = File(...), gpu: int = Form(0), regions: str | None = Form(None), lama_all: int = Form(0)):
    gpu = _gpu(gpu)
    img = _image(image)
    regs = [Region(**r).model_dump() for r in json.loads(regions)] if regions else None
    with GPU_LOCKS[gpu]:
        try:
            return clean.clean_page(img, gpu, regs, bool(lama_all))
        except Exception as e:
            if clean.is_oom(e):
                return JSONResponse({"error": "OOM", "gpu": gpu}, status_code=507)
            raise


@app.post("/cutout")
def cutout_ep(image: UploadFile = File(...), gpu: int = Form(0), rect: str | None = Form(None)):
    gpu = _gpu(gpu)
    img = _image(image)
    r = json.loads(rect) if rect else None
    t = time.time()
    with GPU_LOCKS[gpu]:
        try:
            png = cutout.cutout(img, gpu, r)
        except Exception as e:
            if clean.is_oom(e):
                return JSONResponse({"error": "OOM", "gpu": gpu}, status_code=507)
            raise
    return Response(png, media_type="image/png", headers={"X-Elapsed-Ms": str(int((time.time() - t) * 1000))})
