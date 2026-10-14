import type { FontId } from '@/app/fonts';

export type Lang = 'en' | 'ja' | 'other';
export type Kind = 'bubble' | 'free';                       // worker: closed white bubble / text over art
export type Role = 'dialogue' | 'sfx' | 'sign' | 'narration'; // Gemini
export type Box = [x: number, y: number, w: number, h: number];
export type Inpaint = 'auto' | 'fill' | 'lama';

export type TextStyle = { font: FontId; size: 'auto' | number; weight: 400 | 700; stroke: number; color: string; align: 'center' | 'left' };

export type Region = {
  id: string; kind: Kind;
  box: Box;                 // text box from the detector (used for re-clean masks)
  frame?: Box;              // layout frame for the Thai text: bubble interior (or box); the user drags/resizes this
  profile?: [number, number][]; // usable [left,right] per sampled row of the frame (bubble shape) from the worker
  manual?: boolean;         // frame was moved/resized by the user: keep it across re-clean, ignore the profile
  vertical: boolean; lang: Lang;
  ellipse?: boolean;        // frame is a whole bubble interior -> inscribed-ellipse fitting
  text_h?: number;          // original lettering height (px) from the worker; caps the auto font size
  bg_gray?: number;         // background brightness under the text (0-255) from the worker; <235 => outline by default
  role?: Role; src?: string; th?: string; names?: string[]; style?: Partial<TextStyle>; inpaint?: Inpaint;
};

export type PageStatus = 'new' | 'busy' | 'cleaned' | 'translated' | 'error';

/** Page metadata + image URLs. Editable regions live in store.regions[page.id] so undo/redo only tracks edits. */
export type Page = {
  id: string; name: string; w: number; h: number; file: File; srcUrl: string;
  cleanUrl?: string; maskUrl?: string; cutoutUrl?: string;
  bubbles: Record<string, Box>; order: string[];
  status: PageStatus; error?: string; warnings: string[]; inpaintUsed: Record<string, 'fill' | 'lama'>;
};

export type Gpu = { index: number; name: string; util: number; mem_used_mb: number; mem_total_mb: number; temp: number; busy: boolean };

export type CleanOut = {
  w: number; h: number; regions: Region[]; bubbles: Record<string, Box>; profiles: Record<string, [number, number][]>; order: string[];
  clean_png_b64: string; mask_png_b64: string; inpaint_used: Record<string, 'fill' | 'lama'>; warnings: string[];
};

export type TranslateReq = {
  image?: string;                                          // PNG base64 with numbered labels (omit for text-only)
  regions: { id: string; lang: Lang; vertical: boolean; src?: string }[];
  order: string[];
  glossary?: string[];                                     // Thai renderings of names already used on other pages
};
export type TranslateItem = { id: string; lang: Lang; role: Role; src: string; th: string; names: string[] };
export type TranslateOut = TranslateItem[];

export const DEFAULT_STYLE: TextStyle = { font: 'Sarabun', size: 'auto', weight: 400, stroke: 0, color: '#111111', align: 'center' };
export const frameOf = (r: Region): Box => r.frame ?? r.box;
