Set-Location -LiteralPath $PSScriptRoot                 # uvicorn finds main.py from cwd
$env:CUDA_DEVICE_ORDER = "PCI_BUS_ID"                    # NVML index == ORT device_id == nvidia-smi
$env:MODEL_DIR = "$PSScriptRoot\models"
& ".\.venv\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000
