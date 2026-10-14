import type { Box, Region } from './types';

const loadImage = (url: string) => new Promise<HTMLImageElement>((res, rej) => {
  const img = new Image();
  img.onload = () => res(img);
  img.onerror = () => rej(new Error('โหลดรูปไม่ได้'));
  img.src = url;
});

const b64 = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/png').split(',')[1];

/** Original page + thin red boxes + white id pills placed just outside each box (never over the glyphs). Returns base64 PNG. */
export async function labeledPng(srcUrl: string, regions: Region[]): Promise<string> {
  const img = await loadImage(srcUrl);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  g.lineWidth = 2; g.font = 'bold 15px Arial'; g.textBaseline = 'middle';
  for (const r of regions) {
    const [x, y, w, h] = r.box;
    g.strokeStyle = '#e00'; g.strokeRect(x, y, w, h);
    const tw = g.measureText(r.id).width + 10;
    const px = Math.max(0, Math.min(c.width - tw, x)), py = y >= 20 ? y - 20 : y + h + 2;
    g.fillStyle = '#fff'; g.fillRect(px, py, tw, 18);
    g.strokeRect(px, py, tw, 18);
    g.fillStyle = '#e00'; g.fillText(r.id, px + 5, py + 9);
  }
  return b64(c);
}

/** 2x crop of one region (for single-box re-translation). Returns base64 PNG. */
export async function cropPng(srcUrl: string, box: Box, scale = 2, pad = 8): Promise<string> {
  const img = await loadImage(srcUrl);
  const [x, y, w, h] = box;
  const sx = Math.max(0, x - pad), sy = Math.max(0, y - pad);
  const sw = Math.min(img.naturalWidth - sx, w + 2 * pad), sh = Math.min(img.naturalHeight - sy, h + 2 * pad);
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  const g = c.getContext('2d')!;
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return b64(c);
}

/** White-on-black mask PNG (base64) -> translucent red overlay object URL for the Mask view. */
export async function tintMask(maskB64: string): Promise<string> {
  const img = await loadImage(`data:image/png;base64,${maskB64}`);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) { const v = px[i]; px[i] = 255; px[i + 1] = 40; px[i + 2] = 40; px[i + 3] = Math.round(v * 0.55); }
  g.putImageData(d, 0, 0);
  const blob = await new Promise<Blob>((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('mask'))), 'image/png'));
  return URL.createObjectURL(blob);
}
