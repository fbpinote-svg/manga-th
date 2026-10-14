// Page-level operations shared by buttons and shortcuts. Thin wrappers around the worker/Gemini API + store.
import type Konva from 'konva';
import * as api from './api';
import { OomError } from './api';
import { download, pngName, stagePng, zipBlobs } from './export';
import { cropPng, labeledPng, tintMask } from './label';
import { useStore } from './store';
import type { Box, Region } from './types';

let stage: Konva.Stage | null = null;
let hideOnExport: () => Konva.Node[] = () => [];
export const registerStage = (s: Konva.Stage | null, hide: () => Konva.Node[]) => {
  stage = s; hideOnExport = hide;
  if (typeof window !== 'undefined') (window as unknown as { __stage: Konva.Stage | null }).__stage = s;   // dev/debug
};

const st = () => useStore.getState();
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const oomHint = (e: unknown) => (e instanceof OomError ? ` → ลองเลือก GPU ${e.gpu === 0 ? 1 : 0}` : '');
export const toast = (t: string) => { st().setToast(t); setTimeout(() => { if (st().toast === t) st().setToast(null); }, 6000); };

async function job<T>(label: string, pageId: string, fn: () => Promise<T>): Promise<T | null> {
  const s = st();
  if (s.busy) return null;
  s.setBusy(label);
  s.setPage(pageId, { status: 'busy', error: undefined });
  try {
    return await fn();
  } catch (e) {
    const text = msg(e) + oomHint(e);
    st().setPage(pageId, { status: 'error', error: text });
    toast(text);
    return null;
  } finally {
    st().setBusy(null);
  }
}

/** Detect + clean on the selected GPU. reuse=true sends the current boxes back (re-clean after edits). */
export async function cleanPage(pageId: string, reuse = false) {
  const s = st();
  const page = s.pages.find(p => p.id === pageId);
  if (!page) return;
  await job(`Clean ${page.name}`, pageId, async () => {
    const prevList = s.regions[pageId] ?? [];
    const out = await api.clean(page.file, s.gpuIndex, reuse ? prevList : undefined, s.lamaAll);
    const prev = new Map(prevList.map(r => [r.id, r]));
    const regions: Region[] = out.regions.map(r => {
      const p = prev.get(r.id);
      const auto = { frame: out.bubbles[r.id] ?? r.box, profile: out.profiles?.[r.id] };
      return { ...r, ...(p?.manual && p.frame ? { frame: p.frame, manual: true } : auto), src: p?.src, th: p?.th, role: p?.role, names: p?.names, style: p?.style, lang: p?.src ? p.lang : r.lang };
    });
    st().setRegions(pageId, regions);
    st().setPage(pageId, {
      cleanUrl: api.b64ToUrl(out.clean_png_b64), maskUrl: await tintMask(out.mask_png_b64), bubbles: out.bubbles, order: out.order,
      status: regions.some(r => r.th) ? 'translated' : 'cleaned', warnings: out.warnings, inpaintUsed: out.inpaint_used,
    });
    if (st().view === 'orig' || st().view === 'cutout') st().setView('final');
    if (out.warnings.length) toast(`เตือน: ${out.warnings.join('; ')}`);
  });
}

/** One Gemini call per page: reads every numbered box (EN/JP) and returns Thai. */
export async function translatePage(pageId: string) {
  const s = st();
  const page = s.pages.find(p => p.id === pageId);
  const regions = s.regions[pageId] ?? [];
  if (!page) return;
  if (!regions.length) { toast('กด Clean ก่อนเพื่อหาตำแหน่งข้อความ'); return; }
  await job(`Translate ${page.name}`, pageId, async () => {
    const image = await labeledPng(page.srcUrl, regions);
    const order = page.order.filter(id => regions.some(r => r.id === id));
    for (const r of regions) if (!order.includes(r.id)) order.push(r.id);
    const glossary = [...new Set(Object.entries(s.regions).flatMap(([pid, rs]) => (pid === pageId ? [] : rs.flatMap(r => r.names ?? []))))];
    const out = await api.translate({ image, regions: regions.map(r => ({ id: r.id, lang: r.lang, vertical: r.vertical })), order, glossary });
    const byId = new Map(out.map(o => [o.id, o]));
    st().setRegions(pageId, regions.map(r => { const o = byId.get(r.id); return o ? { ...r, src: o.src, th: o.th, role: o.role, lang: o.lang, names: o.names } : r; }));
    st().setPage(pageId, { status: 'translated' });
    st().setView('final');
  });
}

/** Re-translate a single box: text-only when the user edited `src`, otherwise a 2x crop of the box. */
export async function translateRegion(pageId: string, id: string, textOnly: boolean) {
  const s = st();
  const page = s.pages.find(p => p.id === pageId);
  const r = (s.regions[pageId] ?? []).find(x => x.id === id);
  if (!page || !r) return;
  await job(`Translate ${id}`, pageId, async () => {
    const req = textOnly && r.src
      ? { regions: [{ id, lang: r.lang, vertical: r.vertical, src: r.src }], order: [id] }
      : { image: await cropPng(page.srcUrl, r.box), regions: [{ id, lang: r.lang, vertical: r.vertical }], order: [id] };
    const [o] = await api.translate(req);
    if (o) st().setRegion(pageId, id, { src: o.src, th: o.th, role: o.role, lang: o.lang, names: o.names });
    st().setPage(pageId, { status: 'translated' });
  });
}

/** Character cutout (transparent PNG) of the original page, optionally limited to the drawn rectangle. */
export async function cutoutPage(pageId: string, rect: Box | null) {
  const s = st();
  const page = s.pages.find(p => p.id === pageId);
  if (!page) return;
  const prevStatus = page.status;
  await job(`Cutout ${page.name}`, pageId, async () => {
    const blob = await api.cutout(page.file, s.gpuIndex, rect ?? undefined);
    st().setPage(pageId, { cutoutUrl: URL.createObjectURL(blob), status: prevStatus === 'new' ? 'new' : prevStatus });
    st().setView('cutout');
  });
}

export async function runAll() {
  for (const p of st().pages) {
    if (st().busy) break;
    if (p.status === 'new' || p.status === 'error') await cleanPage(p.id);
    const after = st().pages.find(x => x.id === p.id);
    if (after?.status === 'cleaned') await translatePage(p.id);
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Render the current page (final view) at native resolution. */
async function renderPage(pageId: string): Promise<Blob> {
  const s = st();
  const page = s.pages.find(p => p.id === pageId)!;
  if (s.cur !== pageId) s.setCur(pageId);
  if (s.view !== 'final') s.setView('final');
  s.select(null);
  for (let i = 0; i < 40 && (st().stagePage !== pageId || !st().fontsReady || !stage); i++) await sleep(250);
  await sleep(100);
  if (!stage) throw new Error('stage ยังไม่พร้อม');
  if (st().stagePage !== pageId) throw new Error('รูปหน้านี้ยังโหลดไม่เสร็จ');
  return stagePng(stage, page.w, page.h, hideOnExport());
}

/** Dev hook: window.__render(pageId) -> Blob of the final page (used by automated checks). */
if (typeof window !== 'undefined' && process.env.NODE_ENV !== 'production') {
  (window as unknown as { __render: (id: string) => Promise<Blob> }).__render = renderPage;
}

export async function exportPng(pageId: string) {
  const page = st().pages.find(p => p.id === pageId);
  if (!page || st().busy) return;
  st().setBusy('Export');
  try {
    if (st().view === 'cutout' && page.cutoutUrl) download(await (await fetch(page.cutoutUrl)).blob(), pngName(page.name, '_cutout'));
    else download(await renderPage(pageId), pngName(page.name, '_th'));
  } catch (e) { toast(msg(e)); } finally { st().setBusy(null); }
}

export async function exportZip() {
  const s = st();
  if (s.busy || !s.pages.length) return;
  s.setBusy('Export ZIP');
  const keepCur = s.cur;
  try {
    const items = [];
    for (const p of st().pages) items.push({ name: pngName(p.name, '_th'), blob: await renderPage(p.id) });
    download(await zipBlobs(items), 'manga_th.zip');
  } catch (e) { toast(msg(e)); } finally { st().setBusy(null); if (keepCur) st().setCur(keepCur); }
}
