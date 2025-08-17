/// <reference types="@cloudflare/workers-types" />

export interface Env {
  // Static assets (Cloudflare Pages/ASSETS binding)
  ASSETS: { fetch: typeof fetch };

  // Secret: classic (string) or Secrets Store (object with get()) — we support both
  PPLX_API_KEY?: string | { get: () => Promise<string> };

  // Optional non-secret defaults (keep empty if you want)
  PPLX_BASE?: string;   // e.g. "https://api.perplexity.ai"
  PPLX_MODEL?: string;  // e.g. "sonar" | "sonar-pro" | "sonar-reasoning"
}

/* ---------- Your existing allow-list for /api proxy ---------- */
const ALLOWED = new Set<string>([
  'https://api.exchangerate.host',
  'https://api.frankfurter.app',
  'https://ifsc.razorpay.com',
  'https://api.qrserver.com',
  'https://api.ipify.org',
  'https://ifconfig.me',
]);

/* ---------- Helpers ---------- */
function addSecurityHeaders(h: Headers) {
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Resource-Policy', 'cross-origin');
}
function okCors(h: Headers) {
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Vary', 'Origin');
}
function isHtml(r: Response) {
  const ct = r.headers.get('content-type') || '';
  return ct.includes('text/html');
}
function looksLikeAssetPath(p: string) {
  return /\.[a-z0-9]+$/i.test(p); // has extension
}
function normalizePath(pathname: string) {
  if (pathname !== '/' && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}
async function getSecretMaybe(env: Env, key: keyof Env): Promise<string> {
  const v: any = (env as any)[key];
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (v && typeof v.get === 'function') return await v.get();
  return '';
}

/* ---------- Worker ---------- */
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const pathname = normalizePath(url.pathname);

    /* ----- CORS preflight ----- */
    if (req.method === 'OPTIONS') {
      const h = new Headers();
      okCors(h);
      h.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
      h.set('Access-Control-Max-Age', '3600');
      return new Response(null, { status: 204, headers: h });
    }

    /* ===== 1) SECURE AI PROXY (POST /ai) =====
       Send body like:
       {
         "model": "sonar",
         "stream": true,
         "messages": [{ "role": "user", "content": "Hello!" }]
       }
       We forward to Perplexity's OpenAI-compatible /chat/completions.
    */
    if (pathname === '/ai' && req.method === 'POST') {
      const apiKey = await getSecretMaybe(env, 'PPLX_API_KEY');
      if (!apiKey) {
        const h = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
        okCors(h);
        return new Response('PPLX_API_KEY not configured', { status: 500, headers: h });
      }

      const base = (env.PPLX_BASE || 'https://api.perplexity.ai').replace(/\/+$/, '');
      const endpoint = `${base}/chat/completions`;

      let payload: any;
      try {
        payload = await req.json();
      } catch {
        const h = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
        okCors(h);
        return new Response('Invalid JSON', { status: 400, headers: h });
      }

      const model = payload?.model || env.PPLX_MODEL || 'sonar';
      const stream = payload?.stream !== false; // default true
      const messages = Array.isArray(payload?.messages)
        ? payload.messages
        : [{ role: 'user', content: String(payload?.prompt ?? '') }];

      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model,
          messages,
          stream,
          temperature: typeof payload?.temperature === 'number' ? payload.temperature : 0.4
        })
      });

      // Mirror upstream headers minimally and enable CORS
      const h = new Headers(upstream.headers);
      okCors(h);
      // Ensure proper content-type for SSE
      if (stream) h.set('content-type', 'text/event-stream; charset=utf-8');
      // Prevent caching of AI responses
      h.set('cache-control', 'no-store');

      return new Response(upstream.body, { status: upstream.status, headers: h });
    }

    /* ===== 2) Your existing allow-listed GET proxy (/api?url=...) ===== */
    if (pathname === '/api' && url.searchParams.has('url')) {
      try {
        const target = new URL(url.searchParams.get('url') || '');
        const origin = `${target.protocol}//${target.host}`;
        if (!ALLOWED.has(origin)) return new Response('Forbidden host', { status: 403 });

        const fwd = new Headers(req.headers);
        fwd.delete('cookie');
        fwd.set('accept', 'application/json, image/*, */*;q=0.1');

        const proxied = await fetch(target.toString(), {
          method: 'GET',
          headers: fwd,
          cf: { cacheTtl: 3600, cacheEverything: true },
        });

        const out = new Response(proxied.body, { status: proxied.status, headers: proxied.headers });
        okCors(out.headers);
        out.headers.set('Cache-Control', 'public, max-age=3600');
        addSecurityHeaders(out.headers);
        return out;
      } catch {
        return new Response('Bad Request', { status: 400 });
      }
    }

    /* ===== 3) Friendly health check ===== */
    if (pathname === '/health') {
      const h = new Headers({ 'content-type': 'text/plain; charset=utf-8' });
      addSecurityHeaders(h);
      return new Response('ok', { status: 200, headers: h });
    }

    /* ===== 4) Static routing (subpage /path/index.html) ===== */
    if (pathname !== '/' && !looksLikeAssetPath(pathname)) {
      const indexReq = new Request(new URL(`${pathname}/index.html`, req.url), req);
      const r = await env.ASSETS.fetch(indexReq);
      if (r.status === 200) {
        const out = new Response(r.body, r);
        if (isHtml(out)) out.headers.set('Cache-Control', 'no-store, must-revalidate');
        addSecurityHeaders(out.headers);
        return out;
      }
      // fall through
    }

    /* ===== 5) Normal asset/page fetch with SPA fallback ===== */
    const res = await env.ASSETS.fetch(req);

    if (res.status === 404 && pathname !== '/') {
      const rootRes = await env.ASSETS.fetch(new Request(new URL('/', req.url), req));
      const out = new Response(rootRes.body, rootRes);
      if (isHtml(out)) out.headers.set('Cache-Control', 'no-store, must-revalidate');
      addSecurityHeaders(out.headers);
      return out;
    }

    const out = new Response(res.body, res);
    if (isHtml(out)) out.headers.set('Cache-Control', 'no-store, must-revalidate');
    addSecurityHeaders(out.headers);
    return out;
  },
};
