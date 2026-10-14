'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as KImage, Layer, Rect, Stage as KStage, Transformer } from 'react-konva';
import type Konva from 'konva';
import useImage from 'use-image';
import BubbleText from './BubbleText';
import { registerStage } from '@/lib/actions';
import { curPage, curRegions, useStore, type View } from '@/lib/store';
import type { Box } from '@/lib/types';

const VIEWS: [View, string][] = [['orig', 'ต้นฉบับ'], ['clean', 'Clean'], ['mask', 'Mask'], ['final', 'Final'], ['cutout', 'Cutout']];

export default function Stage() {
  const page = useStore(curPage);
  const regions = useStore(curRegions);
  const { view, sel, select, setView, addRegion, cropRect, setCropRect, style, setStagePage } = useStore();
  const wrap = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Rect>());
  const [size, setSize] = useState({ w: 800, h: 600 });
  // zoom/pan are keyed by page id so switching pages resets them without an effect
  const [vp, setVp] = useState<{ id: string | undefined; zoom: number; pos: { x: number; y: number } }>({ id: undefined, zoom: 1, pos: { x: 0, y: 0 } });
  const [space, setSpace] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; box: Box } | null>(null);

  const baseUrl = !page ? '' : view === 'orig' ? page.srcUrl : view === 'cutout' ? page.cutoutUrl ?? page.srcUrl : page.cleanUrl ?? page.srcUrl;
  const [img, imgStatus] = useImage(baseUrl);
  const [maskImg] = useImage(view === 'mask' && page?.maskUrl ? page.maskUrl : '');

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const apply = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    apply();
    return () => ro.disconnect();
  }, []);

  const fitScale = page ? Math.min(size.w / page.w, size.h / page.h) : 1;
  const pageId = page?.id;
  const { zoom, pos } = vp.id === pageId ? vp : { zoom: 1, pos: { x: 0, y: 0 } };
  const setPos = (p: { x: number; y: number }) => setVp(v => ({ id: pageId, zoom: v.id === pageId ? v.zoom : 1, pos: p }));
  const scale = fitScale * zoom;
  // the <Stage> only exists while a page is selected, so (re)register whenever that changes
  useEffect(() => { registerStage(stageRef.current, () => (trRef.current ? [trRef.current] : [])); return () => registerStage(null, () => []); }, [pageId]);
  useEffect(() => { setStagePage(page && img && imgStatus === 'loaded' && baseUrl === img.src ? page.id : null); }, [page, img, imgStatus, baseUrl, setStagePage]);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const n = sel ? nodes.current.get(sel) : undefined;
    tr.nodes(n ? [n] : []);
    tr.getLayer()?.batchDraw();
  }, [sel, regions, view]);

  useEffect(() => {
    const typing = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null; return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const down = (e: KeyboardEvent) => { if (e.code === 'Space' && !typing(e)) { setSpace(true); e.preventDefault(); } };
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, []);

  const register = useCallback((id: string, node: Konva.Rect | null) => { if (node) nodes.current.set(id, node); else nodes.current.delete(id); }, []);

  const toPage = () => { const st = stageRef.current!; const p = st.getPointerPosition()!; return { x: (p.x - st.x()) / scale, y: (p.y - st.y()) / scale }; };
  const isEmpty = (t: Konva.Node) => t === stageRef.current || t.name() === 'bg';

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const st = stageRef.current!; const p = st.getPointerPosition()!;
    const nz = Math.min(8, Math.max(0.2, zoom * (e.evt.deltaY > 0 ? 1 / 1.1 : 1.1)));
    const ns = fitScale * nz;
    const at = { x: (p.x - st.x()) / scale, y: (p.y - st.y()) / scale };
    setVp({ id: pageId, zoom: nz, pos: { x: p.x - at.x * ns, y: p.y - at.y * ns } });
  };
  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (space || !page || !isEmpty(e.target)) return;
    const p = toPage(); setDrag({ x0: p.x, y0: p.y, box: [p.x, p.y, 0, 0] }); select(null);
  };
  const onMouseMove = () => {
    if (!drag) return;
    const p = toPage();
    setDrag({ ...drag, box: [Math.min(drag.x0, p.x), Math.min(drag.y0, p.y), Math.abs(p.x - drag.x0), Math.abs(p.y - drag.y0)] });
  };
  const onMouseUp = () => {
    if (!drag || !page) return;
    const b = drag.box.map(Math.round) as Box;
    setDrag(null);
    if (b[2] < 10 || b[3] < 10) return;
    if (view === 'cutout') setCropRect(b); else addRegion(page.id, b);
  };

  return (
    <section ref={wrap} className={`relative h-full overflow-hidden ${view === 'cutout' ? 'checker' : 'bg-neutral-900'}`}>
      <div className="absolute left-2 top-2 z-10 flex items-center gap-1 rounded bg-neutral-950/85 p-1">
        {VIEWS.map(([v, label]) => <button key={v} className={`btn py-1 ${view === v ? 'btn-primary' : ''}`} onClick={() => setView(v)}>{label}</button>)}
        <button className="btn py-1" onClick={() => setVp({ id: pageId, zoom: 1, pos: { x: 0, y: 0 } })}>Fit</button>
        <span className="px-2 text-xs text-neutral-400">{Math.round(scale * 100)}% · ล้อ=ซูม · Space+ลาก=เลื่อน · ลากที่ว่าง={view === 'cutout' ? 'กรอบตัด' : 'กล่องใหม่'}</span>
      </div>
      {page ? (
        <KStage ref={stageRef} width={size.w} height={size.h} scaleX={scale} scaleY={scale} x={pos.x} y={pos.y} draggable={space}
          onDragEnd={e => { if (e.target === stageRef.current) setPos({ x: e.target.x(), y: e.target.y() }); }}
          onWheel={onWheel} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp}
          style={{ cursor: space ? 'grab' : drag ? 'crosshair' : 'default' }}>
          <Layer>
            {img && <KImage image={img} width={page.w} height={page.h} name="bg" />}
            {view === 'mask' && maskImg && <KImage image={maskImg} width={page.w} height={page.h} listening={false} />}
            {view !== 'cutout' && regions.map(r => (
              <BubbleText key={r.id} pageId={page.id} region={r} style={style} selected={sel === r.id} showText={view === 'final'} locked={space} onSelect={select} register={register} />
            ))}
            {view === 'cutout' && cropRect && <Rect x={cropRect[0]} y={cropRect[1]} width={cropRect[2]} height={cropRect[3]} stroke="#f59e0b" dash={[8, 4]} strokeScaleEnabled={false} listening={false} />}
            {drag && <Rect x={drag.box[0]} y={drag.box[1]} width={drag.box[2]} height={drag.box[3]} stroke="#22c55e" dash={[6, 4]} strokeScaleEnabled={false} listening={false} />}
            {view !== 'cutout' && (
              <Transformer ref={trRef} rotateEnabled={false} keepRatio={false} flipEnabled={false} anchorSize={8} borderStroke="#6366f1"
                boundBoxFunc={(o, n) => (n.width < 10 || n.height < 10 ? o : n)} />
            )}
          </Layer>
        </KStage>
      ) : (
        <div className="flex h-full items-center justify-center text-neutral-500">เพิ่มรูปทางซ้ายเพื่อเริ่ม</div>
      )}
    </section>
  );
}
