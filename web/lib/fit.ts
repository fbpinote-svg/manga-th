// Thai-aware text fitting for canvas, shaped to the bubble.
// Break priority: explicit \n  >  spaces (phrases; a function word like คือ/ที่ never ends a line)  >  word units
// (dictionary pieces; ≤2-grapheme pieces, no-break compounds and Gemini-reported names are glued into one unit).
// A unit is never split: the font gets smaller instead. Each line gets the width the bubble really offers at that
// height (row profile from the worker, or an inscribed ellipse), lines are balanced, and the largest fitting size wins,
// preferring a layout with no in-phrase breaks when that costs at most 10% of the size.
export const LINE = 1.5;            // Konva lineHeight multiplier; Thai stacks vowel + tone mark above the baseline
const SP = ' ';                // thin space between phrases inside a line (Thai reads better with light spacing)

export type Frame = { w: number; h: number; ellipse: boolean; profile?: [number, number][] };
export type Fit = { size: number; lines: string[] };
type Wrapped = { lines: string[]; phraseBreaks: number; unitBreaks: number };

/** Common compounds the ICU dictionary splits; users extend this list in the Inspector. */
export const NO_BREAK_DEFAULT = [
  'สถานสงเคราะห์', 'ศาลเจ้า', 'ปีใหม่', 'มีชีวิต', 'ชีวิต', 'โรงเรียน', 'โรงพยาบาล', 'มหาวิทยาลัย', 'สถานการณ์', 'ครอบครัว',
  'ห้องเรียน', 'อาจารย์', 'คุณครู', 'โทรศัพท์', 'คอมพิวเตอร์', 'อินเทอร์เน็ต', 'ร้านอาหาร', 'สถานีรถไฟ', 'รถไฟฟ้า', 'เครื่องบิน',
  'สนามบิน', 'ประเทศ', 'จังหวัด', 'ชั้นเรียน', 'การบ้าน', 'ปิดเทอม', 'วันหยุด', 'เช้านี้', 'คืนนี้', 'วันนี้', 'พรุ่งนี้', 'เมื่อวาน',
  'ตอนนี้', 'ตอนเด็ก', 'เพราะว่า', 'ถึงแม้', 'แต่ว่า', 'ยังไง', 'ทำไม', 'เดี๋ยวนี้', 'ทันที', 'ผู้หญิง', 'ผู้ชาย', 'เด็กผู้หญิง', 'เด็กผู้ชาย',
  'หกเจ็ด', 'สองสาม', 'สี่ห้า', 'แปดเก้า', 'พี่สาว', 'พี่ชาย', 'น้องสาว', 'น้องชาย', 'คุณพ่อ', 'คุณแม่', 'คุณตา', 'คุณยาย',
  'เมินเฉย', 'เฉยเมย', 'ไม่ได้', 'ไม่ใช่', 'ไม่เป็นไร', 'เดี๋ยวนี้', 'บ้านพัก', 'สักพัก', 'ก่อนดีไหม', 'งั้นเหรอ', 'สินะ',
];

/** Function words that look wrong at the end of a line when they stand alone as a phrase. */
const NO_END = new Set(['คือ', 'ที่', 'และ', 'แต่', 'ว่า', 'จะ', 'ก็', 'กับ', 'ของ', 'ใน', 'ให้', 'ถ้า', 'เพราะ', 'หรือ', 'จาก', 'ด้วย', 'โดย',
  'เพื่อ', 'ซึ่ง', 'ถึง', 'เป็น', 'ไม่', 'ยัง', 'ต้อง', 'อยาก', 'ควร', 'กำลัง', 'เคย', 'ส่วน', 'พอ', 'เมื่อ', 'ตอน', 'แม้', 'ทั้ง', 'ต่อ',
  'สำหรับ', 'เกี่ยวกับ', 'แบบ', 'อย่าง', 'เหมือน', 'ประมาณ', 'สัก', 'ราว', 'เกือบ', 'แค่', 'เพียง',
  // titles stay with the name that follows
  'พี่', 'น้อง', 'คุณ', 'ท่าน', 'นาย', 'นาง', 'เจ้า', 'ลุง', 'ป้า', 'น้า', 'อา', 'ตา', 'ยาย', 'ปู่', 'ย่า', 'อาจารย์', 'ครู', 'หมอ', 'ท่านประธาน']);

let ctx: CanvasRenderingContext2D | null = null;
const measurer = () => (ctx ??= document.createElement('canvas').getContext('2d')!);

const wordSeg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'word' }) : null;
const charSeg = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;

const graphemes = (s: string): string[] => (charSeg ? [...charSeg.segment(s)].map(x => x.segment) : [...s]);
const rawWords = (s: string): string[] => (wordSeg ? [...wordSeg.segment(s)].map(x => x.segment) : [s]);

/** Break units of a no-space run: dictionary pieces with no-break words merged and very short pieces glued to the previous unit. */
function units(s: string, noBreak: Set<string>, maxLen: number): string[] {
  const raw = rawWords(s);
  const merged: string[] = [];
  for (let i = 0; i < raw.length; ) {
    let best = 1, acc = raw[i];
    for (let j = i + 1; j < raw.length && acc.length + raw[j].length <= maxLen; j++) {
      acc += raw[j];
      if (noBreak.has(acc)) best = j - i + 1;
    }
    merged.push(raw.slice(i, i + best).join(''));
    i += best;
  }
  const out: string[] = [];
  for (const piece of merged) {
    if (out.length && graphemes(piece).length <= 2) out[out.length - 1] += piece;
    else out.push(piece);
  }
  return out;
}

/** Space-separated phrases of a paragraph; a lone function word is attached to the next phrase so it cannot end a line. */
function phrases(para: string): string[] {
  const out: string[] = [];
  let pending = '';
  for (const p of para.split(/\s+/).filter(Boolean)) {
    if (NO_END.has(p)) { pending = pending ? pending + SP + p : p; continue; }
    out.push(pending ? pending + SP + p : p);
    pending = '';
  }
  if (pending) out.push(pending);
  return out;
}

/** Greedy wrap where line i may be at most widths[i] wide (last width repeats). */
function wrapWidths(text: string, font: string, widths: number[], noBreak: Set<string>, maxLen: number): Wrapped {
  const c = measurer();
  c.font = font;
  const width = (s: string) => c.measureText(s).width;
  const lines: string[] = [];
  let phraseBreaks = 0, unitBreaks = 0;
  const W = () => widths[Math.min(lines.length, widths.length - 1)];

  const byUnits = (u: string[], cur: string): string => {
    for (const x of u) {
      if (cur && width(cur + x) > W()) { lines.push(cur); cur = ''; }
      if (width(x) > W()) {                          // a single unit wider than the line: split by grapheme (last resort)
        unitBreaks++;
        for (const g of graphemes(x)) {
          if (cur && width(cur + g) > W()) { lines.push(cur); cur = ''; }
          cur += g;
        }
      } else cur += x;
    }
    return cur;
  };

  for (const para of text.replace(/\r/g, '').split('\n')) {
    let cur = '';
    for (const phrase of phrases(para)) {
      const cand = cur ? cur + SP + phrase : phrase;
      if (width(cand) <= W()) { cur = cand; continue; }
      if (cur) { lines.push(cur); cur = ''; }
      if (width(phrase) <= W()) cur = phrase;
      else { phraseBreaks++; cur = byUnits(units(phrase, noBreak, maxLen), ''); }
    }
    lines.push(cur);
  }
  return { lines: lines.length ? lines : [''], phraseBreaks, unitBreaks };
}

/** Width available to each of n centred lines of the given size: bubble row profile, inscribed ellipse, or rectangle. */
function lineWidths(frame: Frame, n: number, size: number): number[] {
  const lh = size * LINE, top = (frame.h - n * lh) / 2;
  const margin = Math.max(3, 0.05 * frame.w);
  return Array.from({ length: n }, (_, i) => {
    const y0 = top + i * lh, y1 = y0 + lh;
    if (y0 < 0 || y1 > frame.h) return 0;
    const prof = frame.profile;
    if (prof && prof.length) {
      const rowH = frame.h / prof.length;
      const k0 = Math.max(0, Math.floor(y0 / rowH)), k1 = Math.min(prof.length - 1, Math.ceil(y1 / rowH) - 1);
      let half = Infinity;
      for (let k = k0; k <= k1; k++) {
        const [l, r] = prof[k];
        if (r <= l) return 0;
        half = Math.min(half, frame.w / 2 - l, r - frame.w / 2);   // the line is centred in the frame
      }
      return Math.max(0, 2 * (half - margin));
    }
    if (frame.ellipse) {
      const a = frame.w / 2, b = frame.h / 2;
      const yf = Math.max(Math.abs(y0 - b), Math.abs(y1 - b));
      return yf >= b ? 0 : 2 * a * Math.sqrt(1 - (yf / b) ** 2) * 0.9;
    }
    return frame.w * 0.92;
  });
}

const cache = new Map<string, Fit>();

/**
 * Largest font size (min..max) whose shaped, balanced block fits the frame without splitting any word unit.
 * If keeping every phrase whole costs at most 10% of the size, that layout wins.
 */
export function fit(text: string, frame: Frame, family: string, weight: 400 | 700, fixed?: number, min = 8, max = 96, noBreakList: string[] = NO_BREAK_DEFAULT): Fit {
  const key = `${text}|${frame.w}|${frame.h}|${frame.ellipse}|${frame.profile ? frame.profile.map(p => p.join('-')).join(';') : ''}|${family}|${weight}|${fixed ?? ''}|${min}|${max}|${noBreakList.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const noBreak = new Set(noBreakList.filter(Boolean));
  const maxLen = Math.max(1, ...noBreakList.map(w => w.length));
  const c = measurer();
  const maxH = frame.h * 0.9;

  const layout = (size: number) => {
    const font = `${weight} ${size}px ${family}`;
    c.font = font;
    let n = wrapWidths(text, font, [frame.w * 0.9], noBreak, maxLen).lines.length;
    let widths = lineWidths(frame, n, size);
    let w = wrapWidths(text, font, widths, noBreak, maxLen);
    for (let it = 0; it < 4 && w.lines.length !== n; it++) {      // line count changes the row each line sits on
      n = w.lines.length;
      widths = lineWidths(frame, n, size);
      w = wrapWidths(text, font, widths, noBreak, maxLen);
    }
    // balance: shrink all widths by a common factor while keeping the line count and no extra breaks
    if (w.lines.length > 1) {
      let lo = 0.3, hi = 1, best = w;
      for (let it = 0; it < 7; it++) {
        const f = (lo + hi) / 2;
        const t = wrapWidths(text, font, widths.map(x => x * f), noBreak, maxLen);
        if (t.lines.length <= w.lines.length && t.phraseBreaks <= w.phraseBreaks && t.unitBreaks <= w.unitBreaks) { best = t; hi = f; } else lo = f;
      }
      w = best;
    }
    c.font = font;
    const final = lineWidths(frame, w.lines.length, size);
    const fits = w.lines.length * size * LINE <= maxH && w.lines.every((l, i) => final[i] > 0 && c.measureText(l).width <= final[i]);
    return { lines: w.lines, ok: fits && w.unitBreaks === 0, strict: fits && w.unitBreaks === 0 && w.phraseBreaks === 0 };
  };
  const search = (strict: boolean): Fit | null => {
    let lo = min, hi = Math.max(min, max), found: Fit | null = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = layout(mid);
      if (strict ? r.strict : r.ok) { found = { size: mid, lines: r.lines }; lo = mid + 1; } else hi = mid - 1;
    }
    return found;
  };
  let result: Fit;
  if (fixed) {
    result = { size: fixed, lines: layout(fixed).lines };
  } else {
    const loose = search(false) ?? { size: min, lines: layout(min).lines };
    const strict = search(true);
    result = strict && strict.size >= 0.9 * loose.size ? strict : loose;   // keep phrases whole only if it costs <= 10% size
  }
  if (cache.size > 2000) cache.clear();
  cache.set(key, result);
  return result;
}

export const clearFitCache = () => cache.clear();
