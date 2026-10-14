import { Sarabun, Kanit, Prompt, Mitr, Itim, Mali, Sriracha, Taviraj } from 'next/font/google';

// Thai families for manga lettering. Itim and Sriracha ship weight 400 only.
export const sarabun = Sarabun({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-sarabun' });
export const kanit = Kanit({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-kanit' });
export const prompt = Prompt({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-prompt' });
export const mitr = Mitr({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-mitr' });
export const itim = Itim({ subsets: ['thai', 'latin'], weight: '400', display: 'swap', variable: '--f-itim' });
export const mali = Mali({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-mali' });
export const sriracha = Sriracha({ subsets: ['thai', 'latin'], weight: '400', display: 'swap', variable: '--f-sriracha' });
export const taviraj = Taviraj({ subsets: ['thai', 'latin'], weight: ['400', '700'], display: 'swap', variable: '--f-taviraj' });

export const FONTS = { Sarabun: sarabun, Kanit: kanit, Prompt: prompt, Mitr: mitr, Itim: itim, Mali: mali, Sriracha: sriracha, Taviraj: taviraj } as const;
export type FontId = keyof typeof FONTS;
export const FONT_IDS = Object.keys(FONTS) as FontId[];
export const WEIGHTS: Record<FontId, (400 | 700)[]> = {
  Sarabun: [400, 700], Kanit: [400, 700], Prompt: [400, 700], Mitr: [400, 700], Itim: [400], Mali: [400, 700], Sriracha: [400], Taviraj: [400, 700],
};
export const FONT_NOTE: Record<FontId, string> = {
  Sarabun: 'อ่านง่าย มาตรฐาน', Kanit: 'หนา ตะโกน', Prompt: 'เรียบ ทันสมัย', Mitr: 'การ์ตูน กลม', Itim: 'เด็ก ลำลอง', Mali: 'ลายมือ กลม', Sriracha: 'พู่กัน SFX', Taviraj: 'บรรยาย serif',
};
/** Literal family string (with fallbacks) usable directly in canvas/Konva; canvas cannot resolve CSS variables. */
export const family = (id: FontId) => FONTS[id].style.fontFamily;
