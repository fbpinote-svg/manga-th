"""Lazy ONNX Runtime sessions, one per (model, gpu). Models are read as bytes so Thai paths never reach ORT."""
import os, threading
import onnxruntime as ort

MODEL_DIR = os.environ.get("MODEL_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
FILES = {"ctd": "comictextdetector.onnx", "lama": "lama_fp32.onnx", "isnet": "isnet-anime.onnx"}
_lock = threading.Lock()
_cache: dict[tuple[str, int], ort.InferenceSession] = {}

try:
    ort.preload_dlls()          # picks up nvidia-* CUDA 13 / cuDNN 9 wheels installed next to onnxruntime-gpu
except Exception as e:          # pragma: no cover
    print("preload_dlls failed:", e)


def providers() -> list[str]:
    return ort.get_available_providers()


def get(model: str, gpu: int) -> ort.InferenceSession:
    key = (model, gpu)
    with _lock:
        s = _cache.get(key)
        if s is None:
            with open(os.path.join(MODEL_DIR, FILES[model]), "rb") as f:
                data = f.read()
            opts = ort.SessionOptions()
            opts.log_severity_level = 3
            s = ort.InferenceSession(data, opts, providers=[("CUDAExecutionProvider", {"device_id": gpu}), "CPUExecutionProvider"])
            if s.get_providers()[0] != "CUDAExecutionProvider":
                print(f"WARNING: {model} on gpu {gpu} fell back to CPU: {s.get_providers()}")
            print(f"loaded {model} on gpu {gpu}: inputs={[(i.name, i.shape) for i in s.get_inputs()]} outputs={[(o.name, o.shape) for o in s.get_outputs()]}")
            _cache[key] = s
    return s


def loaded() -> list[dict]:
    return [{"model": m, "gpu": g} for (m, g) in _cache]
