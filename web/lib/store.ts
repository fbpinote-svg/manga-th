import { create } from 'zustand';
import { temporal } from 'zundo';
import type { Box, Gpu, Page, Region, TextStyle } from './types';
import { DEFAULT_STYLE } from './types';
import { NO_BREAK_DEFAULT } from './fit';

export type View = 'orig' | 'clean' | 'mask' | 'final' | 'cutout';
export type WorkerState = 'unknown' | 'ok' | 'offline';

type Regions = Record<string, Region[]>;

export type S = {
  pages: Page[];
  regions: Regions;                 // editable per page (the only thing tracked by undo/redo)
  cur: string | null;
  sel: string | null;
  view: View;
  gpuIndex: number;
  style: TextStyle;
  noBreak: string[];                // words that must never be split across lines (user-editable)
  lamaAll: boolean;
  gpus: Gpu[];
  worker: WorkerState;
  fontsReady: boolean;
  busy: string | null;              // label of the running job, disables buttons
  cropRect: Box | null;             // user-drawn rectangle for cutout
  stagePage: string | null;         // page id whose image is currently drawn on the stage (export waits for it)
  toast: string | null;

  addFiles(files: File[]): Promise<void>;
  removePage(id: string): void;
  setPage(id: string, patch: Partial<Page>): void;
  setRegions(pageId: string, regions: Region[]): void;
  setRegion(pageId: string, id: string, patch: Partial<Region>): void;
  addRegion(pageId: string, box: Box): string;
  removeRegion(pageId: string, id: string): void;
  setCur(id: string | null): void;
  select(id: string | null): void;
  setView(v: View): void;
  setGpu(i: number): void;
  setStyle(p: Partial<TextStyle>): void;
  setNoBreak(words: string[]): void;
  setLamaAll(b: boolean): void;
  setGpus(g: Gpu[] | null): void;
  setFontsReady(): void;
  setBusy(b: string | null): void;
  setCropRect(b: Box | null): void;
  setStagePage(id: string | null): void;
  setToast(t: string | null): void;
};

const readImage = (file: File) => new Promise<{ url: string; w: number; h: number }>((res, rej) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => res({ url, w: img.naturalWidth, h: img.naturalHeight });
  img.onerror = () => rej(new Error(`อ่านรูปไม่ได้: ${file.name}`));
  img.src = url;
});

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };

// leading-edge throttle: coalesces drags/typing into one undo step
const throttle = <F extends (...a: never[]) => void>(fn: F, ms: number): F => {
  let t = 0;
  return ((...a: never[]) => { const n = Date.now(); if (n - t > ms) { t = n; fn(...a); } }) as F;
};

export const useStore = create<S>()(
  temporal(
    (set, get) => ({
      pages: [], regions: {}, cur: null, sel: null, view: 'final',
      gpuIndex: typeof window === 'undefined' ? 1 : load('gpuIndex', { i: 1 }).i,
      style: typeof window === 'undefined' ? DEFAULT_STYLE : load('style', DEFAULT_STYLE),
      noBreak: typeof window === 'undefined' ? NO_BREAK_DEFAULT : load('noBreak', { w: NO_BREAK_DEFAULT }).w,
      lamaAll: false, gpus: [], worker: 'unknown', fontsReady: false, busy: null, cropRect: null, stagePage: null, toast: null,

      async addFiles(files) {
        const added: Page[] = [];
        for (const file of files.filter(f => f.type.startsWith('image/'))) {
          const { url, w, h } = await readImage(file);
          added.push({ id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: file.name, w, h, file, srcUrl: url,
            bubbles: {}, order: [], status: 'new', warnings: [], inpaintUsed: {} });
        }
        set(s => ({ pages: [...s.pages, ...added], regions: { ...s.regions, ...Object.fromEntries(added.map(p => [p.id, []])) }, cur: s.cur ?? added[0]?.id ?? null }));
      },
      removePage(id) {
        set(s => {
          const regions = { ...s.regions }; delete regions[id];
          const pages = s.pages.filter(p => p.id !== id);
          return { pages, regions, cur: s.cur === id ? pages[0]?.id ?? null : s.cur, sel: null };
        });
      },
      setPage(id, patch) { set(s => ({ pages: s.pages.map(p => p.id === id ? { ...p, ...patch } : p) })); },
      setRegions(pageId, regions) { set(s => ({ regions: { ...s.regions, [pageId]: regions } })); },
      setRegion(pageId, id, patch) {
        set(s => ({ regions: { ...s.regions, [pageId]: (s.regions[pageId] ?? []).map(r => r.id === id ? { ...r, ...patch } : r) } }));
      },
      addRegion(pageId, box) {
        const list = get().regions[pageId] ?? [];
        let n = list.length + 1; while (list.some(r => r.id === `b${n}`)) n++;
        const id = `b${n}`;
        set(s => ({ regions: { ...s.regions, [pageId]: [...list, { id, kind: 'free', box, frame: box, vertical: false, lang: 'other', th: '' }] }, sel: id }));
        return id;
      },
      removeRegion(pageId, id) {
        set(s => ({ regions: { ...s.regions, [pageId]: (s.regions[pageId] ?? []).filter(r => r.id !== id) }, sel: s.sel === id ? null : s.sel }));
      },
      setCur(id) { set({ cur: id, sel: null, cropRect: null }); },
      select(id) { set({ sel: id }); },
      setView(view) { set({ view }); },
      setGpu(i) { save('gpuIndex', { i }); set({ gpuIndex: i }); },
      setStyle(p) { const style = { ...get().style, ...p }; save('style', style); set({ style }); },
      setNoBreak(words) { const w = [...new Set(words.map(x => x.trim()).filter(Boolean))]; save('noBreak', { w }); set({ noBreak: w }); },
      setLamaAll(lamaAll) { set({ lamaAll }); },
      setGpus(g) { set(g ? { gpus: g, worker: 'ok' } : { worker: 'offline' }); },
      setFontsReady() { set({ fontsReady: true }); },
      setBusy(busy) { set({ busy }); },
      setCropRect(cropRect) { set({ cropRect }); },
      setStagePage(stagePage) { set({ stagePage }); },
      setToast(toast) { set({ toast }); },
    }),
    {
      limit: 100,
      partialize: s => ({ regions: s.regions }),
      equality: (a, b) => a.regions === b.regions,
      handleSet: fn => throttle(fn, 250),
    },
  ),
);

export const undo = () => useStore.temporal.getState().undo();
export const redo = () => useStore.temporal.getState().redo();
const EMPTY: Region[] = [];                       // stable reference: selectors must not return a new array each call
export const curPage = (s: S) => s.pages.find(p => p.id === s.cur) ?? null;
export const curRegions = (s: S) => (s.cur ? s.regions[s.cur] ?? EMPTY : EMPTY);
