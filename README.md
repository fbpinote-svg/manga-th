# Manga TH — แปลมังงะเป็นไทย + ตัดภาพด้วย GPU

เว็บแอปสำหรับใช้งานบนเครื่องตัวเอง: ตรวจจับและลบข้อความบนหน้ามังงะ แปลเป็นภาษาไทยด้วย Gemini API จัดวางคำแปล และตัดตัวละครเป็น PNG พื้นหลังโปร่งใส รองรับการเลือก GPU เมื่อมีการ์ดจอ NVIDIA หลายใบ

## ความสามารถ

- นำเข้ารูปหลายหน้า และแก้ไขผ่าน editor ที่ซูม/เลื่อนภาพได้
- ตรวจจับข้อความอังกฤษ/ญี่ปุ่น แล้วลบข้อความด้วยการเติมสีพื้นหรือ LaMa inpainting
- แปลข้อความเป็นไทยด้วย Gemini พร้อมรักษาชื่อตัวละครข้ามหน้า
- ปรับฟอนต์ ขนาด ขอบข้อความ และตำแหน่งกล่องข้อความ พร้อม undo/redo
- ตัดพื้นหลังตัวละครด้วย ISNet anime segmentation
- ส่งออก PNG ทีละหน้า หรือ ZIP ทั้งบท
- เลือก GPU และดูการใช้งาน VRAM/อุณหภูมิจากหน้าเว็บ

## โครงสร้าง

```text
web/      Next.js 16.3.4 + React + react-konva: editor และ API สำหรับ Gemini/worker
worker/   Python + FastAPI + ONNX Runtime CUDA: ตรวจจับข้อความ ลบข้อความ และตัดภาพ
```

Repository นี้เก็บซอร์สโค้ด ไฟล์กำหนด dependency และสคริปต์ดาวน์โหลดโมเดล ส่วน API key, โมเดล AI, รูปทดสอบ, virtual environment, node_modules และไฟล์ build จะไม่ถูกเก็บใน Git

## สิ่งที่ต้องเตรียม

- Windows / PowerShell สำหรับคำสั่งตัวอย่างด้านล่าง
- Node.js และ pnpm ตาม `web/package.json`
- Python 3.12 และ uv
- การ์ดจอ NVIDIA และไดรเวอร์ที่รองรับ CUDA ตาม dependency ใน `worker/requirements.txt`
- Gemini API key ของผู้ใช้งาน

## ติดตั้ง

Clone โปรเจ็กต์ แล้วเริ่มจากโฟลเดอร์ `manga-th`:

```powershell
git clone https://github.com/fbpinote-svg/manga-th.git
cd manga-th
```

ติดตั้ง Python worker และดาวน์โหลดโมเดล:

```powershell
cd worker
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
.\.venv\Scripts\python.exe download_models.py
cd ..
```

โมเดลทั้ง 3 ตัวจะถูกดาวน์โหลดไปยัง `worker/models/` จากแหล่งที่ระบุใน `worker/download_models.py` และมีเงื่อนไขการใช้งานของแต่ละแหล่งแยกกัน

ติดตั้งเว็บและสร้างไฟล์ตั้งค่าส่วนตัว:

```powershell
cd web
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
```

แก้ไข `web/.env.local` แล้วใส่ API key ของตัวเอง:

```dotenv
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-3.5-flash-lite
WORKER_URL=http://127.0.0.1:8000
```

เปลี่ยน `GEMINI_MODEL` ให้ตรงกับโมเดลที่บัญชีของคุณใช้งานได้ โดย API key ถูกอ่านในฝั่ง Next.js server

## รัน

เปิด PowerShell 2 หน้าต่าง โดยเริ่มจากโฟลเดอร์โปรเจ็กต์:

```powershell
# หน้าต่างที่ 1: GPU worker
.\worker\run.ps1
```

```powershell
# หน้าต่างที่ 2: เว็บ editor
cd web
pnpm dev
```

เปิด `http://localhost:3000` และตรวจ `http://127.0.0.1:8000/health` ว่ามี `CUDAExecutionProvider`

สคริปต์เว็บใช้ webpack อยู่แล้ว เพื่อรองรับพาธที่มีอักษรไทย

## วิธีใช้

1. ลากรูปมาวางในแถบซ้าย แล้วเลือกหน้าที่ต้องการ
2. เลือก GPU จากแผงด้านขวา
3. กด **Clean** เพื่อตรวจจับและลบข้อความเดิม
4. กด **Translate** เพื่ออ่านและแปลข้อความเป็นภาษาไทย
5. ปรับคำแปล ฟอนต์ ขนาด และกล่องข้อความบนภาพ
6. ส่งออกเป็น PNG หรือ ZIP
7. สำหรับตัดตัวละคร ให้เข้าโหมด Cutout แล้วเลือกกรอบหรือใช้ทั้งภาพ

คีย์ลัด: `Ctrl+Z/Y` undo/redo · `Tab` เลือกกล่องถัดไป · `Delete` ลบกล่อง · ลูกศรขยับ (`Shift` = 10 px) · `[` / `]` ปรับขนาดตัวอักษร · `Ctrl+E` export · ล้อเมาส์ซูม · `Space` + ลากเพื่อเลื่อนภาพ

## ตรวจสอบซอร์สโค้ด

```powershell
cd web
pnpm exec tsc --noEmit --incremental false
pnpm lint
```

## ถ้ามีปัญหา

- **worker ไม่ตอบ:** ตรวจว่ารัน `worker/run.ps1` แล้ว และ `WORKER_URL` ตรงกับพอร์ต worker
- **มีแต่ CPUExecutionProvider:** ตรวจ dependency CUDA/cuDNN และไดรเวอร์ NVIDIA ของเครื่อง
- **HTTP 507 / หน่วยความจำไม่พอ:** เลือก GPU อีกใบหรือใช้ภาพขนาดเล็กลง
- **Gemini 429:** รอแล้วลองใหม่ตามโควตาของบัญชี ระบบมีการ retry พร้อม backoff
- **โมเดล Gemini ใช้ไม่ได้:** เปลี่ยน `GEMINI_MODEL` เป็นโมเดลที่บัญชีรองรับ
