// Gemini: read every numbered box on the page (EN/JP auto) and translate to Thai in ONE structured request.
import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import type { TranslateItem, TranslateReq } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SCHEMA = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      id: { type: Type.STRING },
      lang: { type: Type.STRING, format: 'enum', enum: ['en', 'ja', 'other'] },
      role: { type: Type.STRING, format: 'enum', enum: ['dialogue', 'sfx', 'sign', 'narration'] },
      src: { type: Type.STRING },
      th: { type: Type.STRING },
      names: { type: Type.ARRAY, items: { type: Type.STRING } },
    },
    required: ['id', 'lang', 'role', 'src', 'th', 'names'],
    propertyOrdering: ['id', 'lang', 'role', 'src', 'th', 'names'],
  },
};

const PROMPT = `You are a professional manga localizer translating into Thai (ภาษาไทย).
INPUT: a manga page image where each text region is outlined in red with a white label pill showing its id (b1, b2, ...) next to the box, plus a JSON list of the same ids in reading order. If no image is given, the JSON contains the source text ("src") to translate.
For EVERY id, return one object: id (unchanged), lang (source language actually seen: en / ja / other), role (dialogue | sfx | sign | narration), src (the exact source text inside that box, original language, empty string if unreadable), th (the Thai translation) and names (every proper noun exactly as written in th — people, places, transliterated words such as ยูนะ, มาฮิรุ, คิเซกิ — so the typesetter never breaks a line inside them; empty array if none).
RULES
- Same ids, same count, same order as the input list. Never merge, split, drop or invent regions. Unreadable box -> src:"" th:"".
- Keep each speaker's register consistent across the page: shouting = short/blunt, children = simple words, formal adults = ครับ/ค่ะ. Keep names and honorifics (-san/-kun/-chan/-sensei, พี่/น้อง/คุณ) consistent on the whole page.
- role "sfx": give a short Thai onomatopoeia (e.g. ヒソ/whisper -> "ซุบซิบ", ドン -> "ตูม"), never a sentence. A box holding only a fragment of a bigger sound effect (a single kana such as ガ or ン, or a lone stroke) gets th:"" so it is left blank.
- Nothing from the source script may remain in th: render Japanese long-vowel marks (ー) and small っ with Thai lengthening/repetition (うそでしょーっ -> โกหกน่า~ or โกหกน่าาา), and drop furigana.
- role "sign": translate sign text; transliterate proper nouns (e.g. きせき園 -> คิเซกิ).
- Keep Thai concise: at most about 1.1x the source length so it fits the same bubble. Natural spoken Thai in the register of the scene (pronouns and tone follow the characters and genre); no romanization, no leftover source language, no explanations.
- Line breaking: put ONE space at each natural clause pause (วรรค) — roughly every 3–6 words, never between every word and never inside a number phrase like หกเจ็ดขวบ — so the typesetter can break lines there. Never put a space inside a word or a name, and do not add line breaks.
- Thai punctuation: no commas or semicolons at all (Thai separates clauses with a space); keep only ? ! … and quotation marks that the source has.
Return ONLY the JSON array.`;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

export async function POST(req: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return Response.json({ error: 'GEMINI_API_KEY ยังไม่ได้ตั้งใน web/.env.local' }, { status: 500 });
  const body = (await req.json()) as TranslateReq;
  if (!body?.regions?.length) return Response.json([]);

  const ai = new GoogleGenAI({ apiKey: key });
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';
  const parts: ({ inlineData: { mimeType: string; data: string } } | { text: string })[] = [];
  if (body.image) parts.push({ inlineData: { mimeType: 'image/png', data: body.image } });
  const glossary = (body.glossary ?? []).filter(g => typeof g === 'string' && g.trim()).slice(0, 200);
  const glossaryNote = glossary.length ? `\nESTABLISHED NAMES from earlier pages of this chapter — reuse these exact Thai spellings whenever the same person/place appears: ${glossary.join(', ')}` : '';
  parts.push({ text: `${PROMPT}${glossaryNote}\n\nINPUT JSON:\n${JSON.stringify({ order: body.order, regions: body.regions })}` });
  const want = new Set(body.regions.map(r => r.id));

  let lastErr = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA,
          ...(body.image ? { mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH } : {}),
          httpOptions: { timeout: 60_000 },
        },
      });
      const raw = JSON.parse(res.text ?? '[]') as Partial<TranslateItem>[];
      const byId = new Map(raw.filter(x => x && typeof x.id === 'string').map(x => [x.id as string, x]));
      const missing = [...want].filter(id => !byId.has(id));
      if (missing.length && attempt === 0) { lastErr = `missing ${missing.join(',')}`; continue; }   // one retry on id mismatch
      // Thai comes back as one run of text: the editor wraps it to the bubble itself (users add manual breaks if wanted)
      const flat = (s: unknown) => (typeof s === 'string' ? s.replace(/\s*\n\s*/g, ' ').replace(/[ \t]+/g, ' ').trim() : '');
      const out: TranslateItem[] = body.order.filter(id => want.has(id)).map(id => {
        const x = byId.get(id);
        const names = Array.isArray(x?.names) ? x.names.filter((n): n is string => typeof n === 'string' && n.trim().length > 1).map(n => n.trim()) : [];
        return { id, lang: (x?.lang as TranslateItem['lang']) ?? 'other', role: (x?.role as TranslateItem['role']) ?? 'dialogue', src: x?.src ?? '', th: flat(x?.th), names };
      });
      return Response.json(out);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
      const rate = /429|RESOURCE_EXHAUSTED|quota|rate/i.test(lastErr);
      if (attempt < 3 && (rate || /503|UNAVAILABLE|fetch failed|timeout/i.test(lastErr))) { await sleep(2000 * 2 ** attempt); continue; }
      break;
    }
  }
  return Response.json({ error: `Gemini: ${lastErr}` }, { status: 502 });
}
