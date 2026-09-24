// Shared guards for the API routes: rate limit, upload size cap, and no-store JSON responses.

const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; reset: number }>();

/** Fixed-window in-memory limiter (single process; enough for the demo, see THR-001). Returns true when the request may proceed. */
export function allow(key: string, limit: number, now = Date.now()): boolean {
  const h = hits.get(key);
  if (!h || now >= h.reset) {
    hits.set(key, { count: 1, reset: now + WINDOW_MS });
    if (hits.size > 10_000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k);
    return true;
  }
  return ++h.count <= limit;
}

export function clientKey(req: Request): string {
  // Behind a trusted proxy this header is set by the proxy; on localhost it is absent.
  return (req.headers.get('x-forwarded-for') ?? 'local').split(',')[0].trim();
}

export const MAX_IMAGE = 12 * 1024 * 1024; // one uploaded image (4 megapixel PNGs are far smaller)
export const MIN_KEY = 8;
export const MAX_UPLOAD = 25 * 1024 * 1024;
export const MIN_PASSWORD = 8;

export function tooLarge(req: Request): boolean {
  const len = Number(req.headers.get('content-length') ?? 0);
  return len > MAX_UPLOAD + 64 * 1024;
}

/** File name safe to show and to use as a download name: no path separators, control characters, or leading dots. */
export function safeFileName(name: string): string {
  let out = '';
  for (const ch of name) out += ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch;
  return out.replace(/^\.+/, '_').slice(0, 100);
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
