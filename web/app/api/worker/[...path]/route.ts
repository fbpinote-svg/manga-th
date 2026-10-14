// Same-origin pass-through to the local Python GPU worker (no CORS, one place for timeouts).
const WORKER = process.env.WORKER_URL ?? 'http://127.0.0.1:8000';

export const dynamic = 'force-dynamic';

async function proxy(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const init: RequestInit = { method: req.method, signal: AbortSignal.timeout(180_000) };
  if (req.method !== 'GET') {
    init.body = await req.arrayBuffer();
    const ct = req.headers.get('content-type');
    if (ct) init.headers = { 'content-type': ct };
  }
  try {
    const res = await fetch(`${WORKER}/${path.join('/')}`, init);
    const headers: Record<string, string> = { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' };
    const ms = res.headers.get('x-elapsed-ms');
    if (ms) headers['x-elapsed-ms'] = ms;
    return new Response(res.body, { status: res.status, headers });
  } catch (e) {
    return Response.json({ error: 'worker_offline', detail: String(e) }, { status: 503 });
  }
}

export { proxy as GET, proxy as POST };
