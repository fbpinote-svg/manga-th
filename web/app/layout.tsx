import type { Metadata } from 'next';
import { FONTS } from './fonts';
import './globals.css';

export const metadata: Metadata = { title: 'Manga TH', description: 'แปลมังงะเป็นไทย ตัดข้อความ/พื้นหลังด้วย GPU' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th" className={Object.values(FONTS).map(f => f.variable).join(' ')}>
      <body className="h-screen overflow-hidden bg-neutral-950 text-neutral-100 antialiased">{children}</body>
    </html>
  );
}
