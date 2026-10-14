import type { Box, CleanOut, Gpu, Region, TranslateOut, TranslateReq } from './types';

const W = '/api/worker';

export class OomError extends Error {
  constructor(public gpu: number) { super(`GPU ${gpu} หน่วยความจำไม่พอ`); }
}

async function check(r: Response, gpu?: number) {
  if (r.status === 507 && gpu !== undefined) throw new OomError(gpu);
  if (r.status === 503) throw new Error('worker ไม่ได้เปิดอยู่ (รัน worker\\run.ps1)');
  if (!r.ok) throw new Error(`${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r;
}

export async function gpus(): Promise<Gpu[]> {
  return (await check(await fetch(`${W}/gpus`, { cache: 'no-store' }))).json();
}

const intBox = (b: Box): Box => [Math.round(b[0]), Math.round(b[1]), Math.round(b[2]), Math.round(b[3])];

export async function clean(file: Blob, gpu: number, regions?: Region[], lamaAll = false): Promise<CleanOut> {
  const fd = new FormData();
  fd.set('image', file);
  fd.set('gpu', String(gpu));
  fd.set('lama_all', lamaAll ? '1' : '0');
  if (regions) fd.set('regions', JSON.stringify(regions.map(r => ({ id: r.id, kind: r.kind, box: intBox(r.box), vertical: r.vertical, lang: r.lang, inpaint: r.inpaint ?? 'auto' }))));
  return (await check(await fetch(`${W}/clean`, { method: 'POST', body: fd }), gpu)).json();
}

export async function cutout(file: Blob, gpu: number, rect?: Box): Promise<Blob> {
  const fd = new FormData();
  fd.set('image', file);
  fd.set('gpu', String(gpu));
  if (rect) fd.set('rect', JSON.stringify(intBox(rect)));
  return (await check(await fetch(`${W}/cutout`, { method: 'POST', body: fd }), gpu)).blob();
}

export async function translate(req: TranslateReq): Promise<TranslateOut> {
  const r = await fetch('/api/translate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(req) });
  if (!r.ok) throw new Error(`แปลไม่สำเร็จ ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

export const b64ToUrl = (b64: string) => URL.createObjectURL(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: 'image/png' }));
