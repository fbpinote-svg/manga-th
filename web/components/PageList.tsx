'use client';
import { useRef, useState } from 'react';
import { runAll } from '@/lib/actions';
import { useStore } from '@/lib/store';
import type { PageStatus } from '@/lib/types';

const DOT: Record<PageStatus, string> = { new: 'bg-neutral-500', busy: 'bg-amber-400 animate-pulse', cleaned: 'bg-sky-400', translated: 'bg-emerald-400', error: 'bg-red-500' };

export default function PageList() {
  const { pages, cur, busy, addFiles, setCur, removePage } = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  return (
    <aside className="flex h-full flex-col gap-2 overflow-hidden border-r border-neutral-800 p-2">
      <div
        onDragOver={e => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); addFiles([...e.dataTransfer.files]); }}
        onClick={() => input.current?.click()}
        className={`cursor-pointer rounded-md border-2 border-dashed p-3 text-center text-xs ${over ? 'border-indigo-400 bg-indigo-950/40' : 'border-neutral-700 text-neutral-400'}`}>
        ลากรูปมาวาง หรือคลิกเลือก
        <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
      </div>
      <button className="btn btn-primary" disabled={!!busy || !pages.length} onClick={runAll}>Run all (Clean → Translate)</button>
      <ol className="flex-1 space-y-1 overflow-y-auto">
        {pages.map((p, i) => (
          <li key={p.id} onClick={() => setCur(p.id)}
            className={`group relative cursor-pointer rounded-md border p-1 ${cur === p.id ? 'border-indigo-500' : 'border-transparent hover:border-neutral-700'}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.srcUrl} alt={p.name} className="w-full rounded bg-neutral-900 object-contain" />
            <div className="mt-1 flex items-center gap-1 text-[11px]">
              <span className={`h-2 w-2 rounded-full ${DOT[p.status]}`} />
              <span className="truncate">{i + 1}. {p.name}</span>
              <button className="ml-auto hidden text-neutral-400 hover:text-red-400 group-hover:block" title="ลบหน้า" onClick={e => { e.stopPropagation(); removePage(p.id); }}>✕</button>
            </div>
            {p.error && <div className="truncate text-[10px] text-red-400" title={p.error}>{p.error}</div>}
          </li>
        ))}
      </ol>
    </aside>
  );
}
