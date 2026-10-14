'use client';
import { FONT_IDS, FONT_NOTE, family, type FontId } from '@/app/fonts';

const SAMPLE = 'สวัสดี ที่นี่ น้ำ ปั้น';

/** Full picker with a Thai sample line rendered in each family. */
export default function FontPicker({ value, onChange }: { value: FontId; onChange: (f: FontId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1">
      {FONT_IDS.map(id => (
        <button key={id} type="button" onClick={() => onChange(id)}
          className={`rounded-md border px-2 py-1 text-left ${value === id ? 'border-indigo-500 bg-indigo-950/40' : 'border-neutral-800 hover:bg-neutral-800'}`}>
          <div className="text-base leading-tight" style={{ fontFamily: family(id) }}>{SAMPLE}</div>
          <div className="text-[10px] text-neutral-400">{id} · {FONT_NOTE[id]}</div>
        </button>
      ))}
    </div>
  );
}

/** Compact select for per-bubble override ('' = follow page style). */
export function FontSelect({ value, onChange }: { value: FontId | ''; onChange: (f: FontId | '') => void }) {
  return (
    <select className="field" value={value} onChange={e => onChange(e.target.value as FontId | '')} style={value ? { fontFamily: family(value) } : undefined}>
      <option value="">ฟอนต์ตามหน้า</option>
      {FONT_IDS.map(id => <option key={id} value={id} style={{ fontFamily: family(id) }}>{id}</option>)}
    </select>
  );
}
