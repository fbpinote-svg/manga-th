# Manga TH — Web editor

Next.js frontend และ API สำหรับ editor แปลมังงะเป็นภาษาไทย

วิธีติดตั้ง worker, ดาวน์โหลดโมเดล และตั้งค่า Gemini อยู่ใน [README หลัก](../README.md)

```powershell
pnpm install --frozen-lockfile
Copy-Item .env.example .env.local
# ใส่ GEMINI_API_KEY ของตัวเองใน .env.local ก่อนแปลข้อความ
pnpm dev
```

เปิด `http://localhost:3000` และรัน Python worker ควบคู่กัน

```powershell
pnpm exec tsc --noEmit --incremental false
pnpm lint
pnpm build
pnpm start
```

สคริปต์ dev/build ใช้ webpack เพื่อรองรับพาธที่มีอักษรไทย
