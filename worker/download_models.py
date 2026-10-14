"""Download the three ONNX models used by the worker (stdlib only, idempotent)."""
import os, sys, urllib.request

MODEL_DIR = os.environ.get("MODEL_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "models")
MODELS = {
    # comic-text-detector (dmMaze) - text boxes + pixel mask, EN/JP
    "comictextdetector.onnx": ("https://github.com/zyddnys/manga-image-translator/releases/download/beta-0.2.1/comictextdetector.pt.onnx", 90_000_000),
    # LaMa inpainting, fixed 512x512, Apache-2.0
    "lama_fp32.onnx": ("https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx", 200_000_000),
    # ISNet anime segmentation (rembg isnet-anime), Apache-2.0
    "isnet-anime.onnx": ("https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-anime.onnx", 170_000_000),
}

def fetch(name, url, min_size):
    dst = os.path.join(MODEL_DIR, name)
    if os.path.exists(dst) and os.path.getsize(dst) >= min_size:
        print(f"ok      {name} ({os.path.getsize(dst)//2**20} MB)"); return
    tmp = dst + ".part"
    print(f"get     {name} <- {url}")
    def hook(n, bs, total):
        if total > 0 and n % 200 == 0: print(f"\r        {min(n*bs, total)//2**20}/{total//2**20} MB", end="", flush=True)
    urllib.request.urlretrieve(url, tmp, hook)
    print()
    size = os.path.getsize(tmp)
    if size < min_size: os.remove(tmp); sys.exit(f"FAILED  {name}: only {size} bytes")
    os.replace(tmp, dst); print(f"done    {name} ({size//2**20} MB)")

if __name__ == "__main__":
    os.makedirs(MODEL_DIR, exist_ok=True)
    for name, (url, min_size) in MODELS.items(): fetch(name, url, min_size)
    print("ALL_MODELS_OK")
