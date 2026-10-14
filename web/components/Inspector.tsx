'use client';
import { useEffect, useRef } from 'react';
import { WEIGHTS, type FontId } from '@/app/fonts';
import { cleanPage, cutoutPage, exportPng, exportZip, translatePage, translateRegion } from '@/lib/actions';
import { curPage, curRegions, useStore } from '@/lib/store';
import type { Inpaint, Region } from '@/lib/types';
import FontPicker, { FontSelect } from './FontPicker';
import GpuPanel from './GpuPanel';

function RegionItem({ pageId, r, selected }: { pageId: string; r: Region; selected: boolean }) {
  const { select, setRegion, removeRegion, busy } = useStore();
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }); }, [selected]);
  const set = (p: Partial<Region>) => setRegion(pageId, r.id, p);
  const style = r.style ?? {};
  return (
    <li ref={ref} onClick={() => select(r.id)} className={`space-y-1 rounded-md border p-2 ${selected ? 'border-indigo-500 bg-indigo-950/30' : 'border-neutral-800'}`}>
      <div className="flex items-center gap-1 text-[11px] text-neutral-400">
        <b className="text-neutral-200">{r.id}</b>
        <span className={`rounded px-1 ${r.kind === 'bubble' ? 'bg-sky-950 text-sky-300' : 'bg-amber-950 text-amber-300'}`}>{r.kind}</span>
        <span>{r.lang}</span>{r.role && <span>· {r.role}</span>}
        <button className="ml-auto text-neutral-500 hover:text-red-400" title="ลบกล่อง" onClick={e => { e.stopPropagation(); removeRegion(pageId, r.id); }}>✕</button>
      </div>
      <input className="field text-neutral-400" placeholder="ต้นฉบับ (src)" value={r.src ?? ''} onChange={e => set({ src: e.target.value })} />
      <textarea className="field min-h-14 text-base" placeholder="คำแปลไทย (ขึ้นบรรทัดใหม่ด้วย Enter)" value={r.th ?? ''} onChange={e => set({ th: e.target.value })} />
      <div className="grid grid-cols-[1fr_64px_72px] gap-1">
        <FontSelect value={style.font ?? ''} onChange={f => set({ style: { ...style, font: f || undefined } })} />
        <input className="field" type="number" min={6} max={200} placeholder="auto" value={typeof style.size === 'number' ? style.size : ''}
          onChange={e => set({ style: { ...style, size: e.target.value ? Number(e.target.value) : undefined } })} title="ขนาด (ว่าง = auto)" />
        <select className="field" value={r.inpaint ?? 'auto'} onChange={e => set({ inpaint: e.target.value as Inpaint })} title="วิธีลบข้อความเมื่อ Re-clean">
          <option value="auto">auto</option><option value="fill">fill</option><option value="lama">LaMa</option>
        </select>
      </div>
      <div className="flex gap-1">
        <button className="btn py-0.5 text-xs" disabled={!!busy} onClick={e => { e.stopPropagation(); translateRegion(pageId, r.id, true); }} title="แปลจากช่อง src (ไม่ส่งรูป)">แปลใหม่ (ข้อความ)</button>
        <button className="btn py-0.5 text-xs" disabled={!!busy} onClick={e => { e.stopPropagation(); translateRegion(pageId, r.id, false); }} title="ส่งครอปกล่องนี้ให้ Gemini อ่านใหม่">แปลใหม่ (รูป)</button>
        <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={(style.stroke ?? 0) > 0} onChange={e => set({ style: { ...style, stroke: e.target.checked ? 3 : 0 } })} />ขอบขาว</label>
      </div>
    </li>
  );
}

export default function Inspector() {
  const page = useStore(curPage);
  const regions = useStore(curRegions);
  const { sel, busy, style, setStyle, lamaAll, setLamaAll, cropRect, setCropRect, view, noBreak, setNoBreak } = useStore();
  const can700 = WEIGHTS[style.font].includes(700);
  const fills = Object.values(page?.inpaintUsed ?? {});

  return (
    <aside className="flex h-full flex-col gap-3 overflow-y-auto border-l border-neutral-800 p-3">
      <GpuPanel />

      <section className="space-y-2">
        <h2 className="text-sm font-bold">งาน {page ? `· ${page.name}` : ''}</h2>
        <div className="grid grid-cols-2 gap-1">
          <button className="btn btn-primary" disabled={!page || !!busy} onClick={() => page && cleanPage(page.id)}>1. Clean</button>
          <button className="btn btn-primary" disabled={!page || !!busy || !regions.length} onClick={() => page && translatePage(page.id)}>2. Translate</button>
          <button className="btn" disabled={!page || !!busy || !regions.length} onClick={() => page && cleanPage(page.id, true)} title="ลบข้อความใหม่ตามกล่องที่แก้">Re-clean กล่องที่แก้</button>
          <button className="btn" disabled={!page || !!busy} onClick={() => page && cutoutPage(page.id, cropRect)}>ตัดพื้นหลัง {cropRect ? '(กรอบ)' : '(ทั้งภาพ)'}</button>
          <button className="btn" disabled={!page || !!busy} onClick={() => page && exportPng(page.id)}>Export PNG {view === 'cutout' ? '(cutout)' : ''}</button>
          <button className="btn" disabled={!page || !!busy} onClick={exportZip}>Export ZIP ทั้งบท</button>
        </div>
        <div className="flex flex-wrap gap-3 text-xs">
          <label className="flex items-center gap-1"><input type="checkbox" checked={lamaAll} onChange={e => setLamaAll(e.target.checked)} />ใช้ LaMa ทุกกล่อง</label>
          {cropRect && <button className="text-amber-300 underline" onClick={() => setCropRect(null)}>ล้างกรอบตัด</button>}
        </div>
        {page && (fills.length > 0 || page.warnings.length > 0) && (
          <p className="rounded bg-neutral-900 p-2 text-[11px] text-neutral-400">
            fill {fills.filter(f => f === 'fill').length} · LaMa {fills.filter(f => f === 'lama').length}
            {page.warnings.length > 0 && <span className="block text-amber-300">⚠ {page.warnings.join('; ')}</span>}
          </p>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">ฟอนต์ไทย (ทั้งหน้า)</h2>
        <FontPicker value={style.font} onChange={(font: FontId) => setStyle({ font, weight: WEIGHTS[font].includes(style.weight) ? style.weight : 400 })} />
        <div className="grid grid-cols-4 gap-1 text-xs">
          <label>ขนาด<input className="field" type="number" min={6} max={200} placeholder="auto" value={typeof style.size === 'number' ? style.size : ''} onChange={e => setStyle({ size: e.target.value ? Number(e.target.value) : 'auto' })} /></label>
          <label>หนา<select className="field" value={style.weight} onChange={e => setStyle({ weight: Number(e.target.value) as 400 | 700 })}><option value={400}>400</option><option value={700} disabled={!can700}>700</option></select></label>
          <label>ขอบขาว<input className="field" type="number" min={0} max={20} value={style.stroke} onChange={e => setStyle({ stroke: Number(e.target.value) })} /></label>
          <label>สี<input className="field h-[30px] p-0.5" type="color" value={style.color} onChange={e => setStyle({ color: e.target.value })} /></label>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-neutral-400">คำห้ามแยกบรรทัด ({noBreak.length})</summary>
          <textarea className="field mt-1 min-h-20 text-xs" defaultValue={noBreak.join(' ')} placeholder="คั่นด้วยช่องว่าง เช่น สถานสงเคราะห์ ศาลเจ้า ชื่อตัวละคร"
            onBlur={e => setNoBreak(e.target.value.split(/\s+/))} />
          <p className="text-[10px] text-neutral-500">พิมพ์ชื่อตัวละคร/คำประสมที่ไม่อยากให้ถูกตัด แล้วคลิกออกจากช่อง</p>
        </details>
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold">กล่องข้อความ ({regions.length})</h2>
        {page && !regions.length && <p className="text-xs text-neutral-500">กด Clean เพื่อหาข้อความ หรือลากบนรูปเพื่อสร้างกล่องเอง</p>}
        <ul className="space-y-2">
          {page && regions.map(r => <RegionItem key={r.id} pageId={page.id} r={r} selected={sel === r.id} />)}
        </ul>
      </section>
    </aside>
  );
}
