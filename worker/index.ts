/// <reference types="@cloudflare/workers-types" />
export interface Env {
  ASSETS: { fetch: typeof fetch };
}

const ALLOWED = new Set<string>([
  'https://api.exchangerate.host',
  'https://api.frankfurter.app',
  'https://ifsc.razorpay.com',
  'https://api.qrserver.com',
  'https://api.ipify.org',
  'https://ifconfig.me',
]);

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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    let pathname = normalizePath(url.pathname);

    // CORS preflight for /api
    if (req.method === 'OPTIONS') {
      const h = new Headers();
      okCors(h);
      h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
      h.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
      h.set('Access-Control-Max-Age', '3600');
      return new Response(null, { status: 204, headers: h });
    }

    // 1) Proxy: /api?url=<encoded>
    if (pathname === '/api' && url.searchParams.has('url')) {
      try {
        const target = new URL(url.searchParams.get('url') || '');
        const origin = `${target.protocol}//${target.host}`;
        if (!ALLOWED.has(origin)) return new Response('Forbidden host', { status: 403 });

        const fwd = new Headers(req.headers);
        fwd.delete('cookie');
        fwd.set('accept', 'application/json, image/*, */*;q=0.1');

        // ✅ With workers-types loaded, cf is now typed and allowed
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

    // 2) Try subpage /path/index.html for any path without extension (except "/")
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

    // 3) Normal asset/page fetch
    const res = await env.ASSETS.fetch(req);

    // SPA fallback
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
