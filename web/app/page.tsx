'use client';
import dynamic from 'next/dynamic';

// Konva touches `window` at import time: load the editor on the client only.
const Editor = dynamic(() => import('@/components/Editor'), { ssr: false, loading: () => <div className="p-6 text-neutral-400">กำลังโหลด…</div> });

export default function Page() {
  return <Editor />;
}
