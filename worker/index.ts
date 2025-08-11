export interface Env {
  ASSETS: { fetch: typeof fetch };
}

const ALLOWED = new Set([
  'https://api.exchangerate.host',
  'https://api.frankfurter.app',
  'https://ifsc.razorpay.com',
  'https://api.qrserver.com',
  'https://api.ipify.org',
  'https://ifconfig.me',
]);

function isAllowed(url: URL): boolean {
  const origin = `${url.protocol}//${url.host}`;
  return ALLOWED.has(origin);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // Proxy for external APIs: /api?url=<encoded>
    if (url.pathname === '/api' && url.searchParams.has('url')) {
      try {
        const target = new URL(url.searchParams.get('url') || '');
        if (!isAllowed(target)) {
          return new Response('Forbidden host', { status: 403 });
        }
        const headers = new Headers(req.headers);
        headers.delete('cookie');
        headers.set('accept', 'application/json, image/*, */*;q=0.1');
        const proxied = await fetch(target.toString(), { method: 'GET', headers, cf: { cacheTtl: 3600, cacheEverything: true } });
        const resp = new Response(proxied.body, { status: proxied.status, headers: proxied.headers });
        resp.headers.set('Cache-Control', 'public, max-age=3600');
        resp.headers.set('Access-Control-Allow-Origin', '*');
        return resp;
      } catch (err) {
        return new Response('Bad Request', { status: 400 });
      }
    }

    // Serve static assets
    return env.ASSETS.fetch(req);
  }
};


