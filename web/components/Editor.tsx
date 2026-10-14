'use client';
import { useEffect } from 'react';
import { FONT_IDS, WEIGHTS, family } from '@/app/fonts';
import { exportPng } from '@/lib/actions';
import { curPage, curRegions, redo, undo, useStore } from '@/lib/store';
import { frameOf, type Box } from '@/lib/types';
import Inspector from './Inspector';
import PageList from './PageList';
import Stage from './Stage';

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

export default function Editor() {
  const { setFontsReady, busy, toast } = useStore();

  // dev hook: lets scripts/tests drive the editor (window.__store.getState().addFiles([...]))
  useEffect(() => { if (process.env.NODE_ENV !== 'production') (window as unknown as { __store: typeof useStore }).__store = useStore; }, []);

  // fonts must be loaded before measuring text in canvas (metrics are cached per font string)
  useEffect(() => {
    (async () => {
      await Promise.all(FONT_IDS.flatMap(id => WEIGHTS[id].map(w => document.fonts.load(`${w} 32px ${family(id)}`).catch(() => null))));
      await document.fonts.ready;
      setFontsReady();
    })();
  }, [setFontsReady]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (typing(e)) return;
      const s = useStore.getState();
      const page = curPage(s), regs = curRegions(s);
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      if (mod && k === 'z' && !e.shiftKey) { undo(); e.preventDefault(); return; }
      if ((mod && k === 'y') || (mod && k === 'z' && e.shiftKey)) { redo(); e.preventDefault(); return; }
      if (mod && k === 'e') { if (page) exportPng(page.id); e.preventDefault(); return; }
      if (e.key === 'Escape') { s.select(null); return; }
      if (!page) return;
      if (e.key === 'Tab' && regs.length) {
        const i = regs.findIndex(r => r.id === s.sel);
        s.select(regs[(e.shiftKey ? i - 1 + regs.length : i + 1) % regs.length].id);
        e.preventDefault(); return;
      }
      const r = regs.find(x => x.id === s.sel);
      if (!r) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { s.removeRegion(page.id, r.id); return; }
      if (e.key.startsWith('Arrow')) {
        const d = e.shiftKey ? 10 : 1, f = [...frameOf(r)] as Box;
        if (e.key === 'ArrowLeft') f[0] -= d; if (e.key === 'ArrowRight') f[0] += d; if (e.key === 'ArrowUp') f[1] -= d; if (e.key === 'ArrowDown') f[1] += d;
        s.setRegion(page.id, r.id, { frame: f }); e.preventDefault(); return;
      }
      if (e.key === '[' || e.key === ']') {
        const cur = typeof r.style?.size === 'number' ? r.style.size : typeof s.style.size === 'number' ? s.style.size : 24;
        s.setRegion(page.id, r.id, { style: { ...r.style, size: Math.max(6, cur + (e.key === ']' ? 2 : -2)) } });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="grid h-screen grid-cols-[220px_1fr_380px]">
      <PageList />
      <Stage />
      <Inspector />
      {busy && <div className="fixed bottom-3 left-1/2 z-20 -translate-x-1/2 rounded bg-amber-800 px-3 py-1 text-sm shadow">⏳ {busy}</div>}
      {toast && <div className="fixed bottom-12 left-1/2 z-20 max-w-xl -translate-x-1/2 rounded bg-neutral-800 px-3 py-2 text-sm shadow">{toast}</div>}
      <div className="fixed bottom-1 right-2 text-[10px] text-neutral-600">Ctrl+Z/Y undo · Tab เลือกถัดไป · Delete ลบ · ลูกศรขยับ · [ ] ขนาด · Ctrl+E export</div>
    </div>
  );
}
