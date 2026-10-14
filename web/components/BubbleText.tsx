'use client';
import { useEffect, useMemo, useRef } from 'react';
import { Rect, Text } from 'react-konva';
import type Konva from 'konva';
import { WEIGHTS, family } from '@/app/fonts';
import { LINE, fit } from '@/lib/fit';
import { curRegions, useStore } from '@/lib/store';
import { frameOf, type Region, type TextStyle } from '@/lib/types';

type Props = {
  pageId: string; region: Region; style: TextStyle; selected: boolean; showText: boolean; locked: boolean;
  onSelect: (id: string) => void; register: (id: string, node: Konva.Rect | null) => void;
};

/** One text region: Thai text laid out inside its frame + a draggable/resizable hit rectangle. */
export default function BubbleText({ pageId, region: r, style, selected, showText, locked, onSelect, register }: Props) {
  const setRegion = useStore(s => s.setRegion);
  const fontsReady = useStore(s => s.fontsReady);
  const userNoBreak = useStore(s => s.noBreak);
  const pageRegions = useStore(curRegions);
  // user list + every proper noun Gemini reported on this page => never split inside a name
  const noBreak = useMemo(() => [...new Set([...userNoBreak, ...pageRegions.flatMap(x => x.names ?? [])])], [userNoBreak, pageRegions]);
  const rectRef = useRef<Konva.Rect>(null);
  useEffect(() => { register(r.id, rectRef.current); return () => register(r.id, null); }, [r.id, register]);

  const st = { ...style, ...r.style };
  const weight: 400 | 700 = WEIGHTS[st.font].includes(st.weight) ? st.weight : 400;
  const [x, y, w, h] = frameOf(r);
  const text = r.th ?? '';
  const fam = family(st.font);
  const ellipse = r.kind === 'bubble' && !!r.ellipse;
  const cap = r.text_h ? Math.max(12, Math.round(1.6 * r.text_h)) : 96;     // text_h = glyph height; Thai consonants are ~0.65 em, so 1.6x keeps the same visual size
  const profile = r.manual ? undefined : r.profile;
  const f = useMemo(
    () => (fontsReady && text ? fit(text, { w, h, ellipse, profile }, fam, weight, typeof st.size === 'number' ? st.size : undefined, 8, cap, noBreak) : null),
    [fontsReady, text, w, h, ellipse, profile, fam, weight, st.size, cap, noBreak],
  );
  const size = f?.size ?? 16;
  // white outline by default when the text sits over art or a non-white background (SFX, signs, screentone)
  const darkBg = r.kind === 'free' || (r.bg_gray !== undefined && r.bg_gray < 235);
  const stroke = r.style?.stroke ?? (darkBg && style.stroke === 0 ? Math.max(2, Math.round(0.1 * size)) : style.stroke);

  const commit = (n: Konva.Rect) => {
    const nw = Math.max(10, n.width() * n.scaleX()), nh = Math.max(10, n.height() * n.scaleY());
    n.scaleX(1); n.scaleY(1);
    setRegion(pageId, r.id, { frame: [Math.round(n.x()), Math.round(n.y()), Math.round(nw), Math.round(nh)], manual: true });
  };

  return (
    <>
      {showText && f && (
        <Text x={x} y={y} width={w} height={h} text={f.lines.join('\n')} fontSize={size} lineHeight={LINE} fontFamily={fam}
          fontStyle={weight === 700 ? 'bold' : 'normal'} align={st.align} verticalAlign="middle" fill={st.color}
          stroke={stroke > 0 ? '#ffffff' : undefined} strokeWidth={stroke} fillAfterStrokeEnabled lineJoin="round" wrap="none" listening={false} />
      )}
      <Rect ref={rectRef} x={x} y={y} width={w} height={h} draggable={!locked} listening={!locked}
        stroke={selected ? '#6366f1' : 'rgba(99,102,241,0.6)'} strokeWidth={selected ? 2 : 1} dash={selected ? undefined : [6, 4]} strokeScaleEnabled={false}
        fill="rgba(0,0,0,0.001)"
        onClick={() => onSelect(r.id)} onTap={() => onSelect(r.id)}
        onDragStart={() => onSelect(r.id)}
        onDragMove={e => setRegion(pageId, r.id, { frame: [Math.round(e.target.x()), Math.round(e.target.y()), w, h], manual: true })}
        onDragEnd={e => commit(e.target as Konva.Rect)}
        onTransform={e => commit(e.target as Konva.Rect)}
        onTransformEnd={e => commit(e.target as Konva.Rect)} />
    </>
  );
}
