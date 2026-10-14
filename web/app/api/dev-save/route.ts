// Dev-only helper: POST raw PNG bytes -> web/.debug/<name>.png (lets automated checks inspect the rendered canvas).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (process.env.NODE_ENV === 'production') return new Response('disabled', { status: 404 });
  const name = (new URL(req.url).searchParams.get('name') ?? 'out.png').replace(/[^\w.-]/g, '_');
  const dir = path.join(process.cwd(), '.debug');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  await writeFile(file, Buffer.from(await req.arrayBuffer()));
  return Response.json({ file });
}
