'use client';
import { useEffect } from 'react';
import { gpus as fetchGpus } from '@/lib/api';
import { useStore } from '@/lib/store';

const Bar = ({ v, max, label, color }: { v: number; max: number; label: string; color: string }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-9 text-neutral-400">{label}</span>
    <div className="h-2 flex-1 overflow-hidden rounded bg-neutral-800">
      <div className={`h-full ${color} transition-[width] duration-500`} style={{ width: `${Math.min(100, (100 * v) / max)}%` }} />
    </div>
    <span className="w-24 text-right tabular-nums">{label === 'util' ? `${v}%` : `${(v / 1024).toFixed(1)} / ${(max / 1024).toFixed(0)} GB`}</span>
  </div>
);

export default function GpuPanel() {
  const { gpus, worker, gpuIndex, setGpu, setGpus } = useStore();

  useEffect(() => {
    let alive = true;
    const tick = async () => { try { const g = await fetchGpus(); if (alive) setGpus(g); } catch { if (alive) setGpus(null); } };
    tick();
    const t = setInterval(tick, 1500);
    return () => { alive = false; clearInterval(t); };
  }, [setGpus]);

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold">GPU</h2>
        <span className={`rounded px-2 py-0.5 text-xs ${worker === 'ok' ? 'bg-emerald-900 text-emerald-200' : worker === 'offline' ? 'bg-red-900 text-red-200' : 'bg-neutral-800'}`}>
          {worker === 'ok' ? 'worker พร้อม' : worker === 'offline' ? 'worker ไม่ตอบ' : 'กำลังเชื่อมต่อ'}
        </span>
      </div>
      {worker === 'offline' && (
        <p className="rounded bg-red-950 p-2 text-xs text-red-200">
          เปิด worker ก่อน: <code className="font-mono">worker\run.ps1</code>
        </p>
      )}
      {gpus.map(g => (
        <label key={g.index} className={`block cursor-pointer rounded-md border p-2 ${gpuIndex === g.index ? 'border-indigo-500 bg-indigo-950/40' : 'border-neutral-800'}`}>
          <div className="mb-1 flex items-center gap-2 text-sm">
            <input type="radio" name="gpu" checked={gpuIndex === g.index} onChange={() => setGpu(g.index)} />
            <span className="font-medium">GPU {g.index}</span>
            <span className="truncate text-xs text-neutral-400">{g.name}</span>
            <span className="ml-auto text-xs tabular-nums text-neutral-400">{g.temp}°C</span>
            {g.busy && <span className="rounded bg-amber-900 px-1 text-[10px] text-amber-200">ทำงาน</span>}
          </div>
          <Bar v={g.util} max={100} label="util" color="bg-emerald-500" />
          <Bar v={g.mem_used_mb} max={g.mem_total_mb} label="VRAM" color="bg-sky-500" />
        </label>
      ))}
    </section>
  );
}
