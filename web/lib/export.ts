import JSZip from 'jszip';
import type Konva from 'konva';

/** Render the stage at native page resolution regardless of the current zoom/pan; `hide` nodes (transformer, guides) are hidden during capture. */
export async function stagePng(stage: Konva.Stage, w: number, h: number, hide: Konva.Node[] = []): Promise<Blob> {
  const saved = { scale: stage.scale(), pos: stage.position(), size: stage.size() };
  const vis = hide.map(n => n.visible());
  hide.forEach(n => n.visible(false));
  stage.scale({ x: 1, y: 1 }); stage.position({ x: 0, y: 0 }); stage.size({ width: w, height: h });
  stage.draw();
  try {
    const canvas = stage.toCanvas({ pixelRatio: 1, x: 0, y: 0, width: w, height: h });
    return await new Promise<Blob>((res, rej) => canvas.toBlob(b => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
  } finally {
    stage.scale(saved.scale); stage.position(saved.pos); stage.size(saved.size);
    hide.forEach((n, i) => n.visible(vis[i]));
    stage.batchDraw();
  }
}

export async function zipBlobs(items: { name: string; blob: Blob }[]): Promise<Blob> {
  const zip = new JSZip();
  items.forEach(i => zip.file(i.name, i.blob));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}

export function download(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

export const pngName = (name: string, suffix = '') => name.replace(/\.[^.]+$/, '') + suffix + '.png';
