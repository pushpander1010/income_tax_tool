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

// List of known subpages
const SUBPAGES = new Set([
  'income-tax-calculator',
  'bmi-calculator',
  'emi-calculator',
  'fd-calculator',
  'sip-calculator',
  'gst-calculator',
  'currency-converter',
  'date-difference',
  'pan-validator',
  'ifsc-finder',
  'ip-address',
  'uuid-generator',
  'json-formatter',
  'base64-encoder',
  'word-counter',
  'text-case-converter',
  'unit-converter',
  'qr-generator',
  'color-picker',
  'age-calculator',
  'password-generator',
  'percentage-calculator'
]);

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Debug logging
    console.log(`[Worker] Request for: ${pathname}`);

    // Proxy for external APIs: /api?url=<encoded>
    if (pathname === '/api' && url.searchParams.has('url')) {
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
        console.error('[Worker] API proxy error:', err);
        return new Response('Bad Request', { status: 400 });
      }
    }

    // Handle static assets first (CSS, JS, etc.) - this is critical for subpages
    if (pathname === '/style.css' || pathname.startsWith('/assets/')) {
      console.log(`[Worker] Serving static asset: ${pathname}`);
      try {
        const response = await env.ASSETS.fetch(req);
        console.log(`[Worker] Asset response status: ${response.status}`);
        
        if (response.status === 200) {
          // Set proper content type for CSS
          if (pathname === '/style.css') {
            const newResponse = new Response(response.body, response);
            newResponse.headers.set('Content-Type', 'text/css');
            newResponse.headers.set('Cache-Control', 'public, max-age=31536000'); // Cache CSS for 1 year
            newResponse.headers.set('Access-Control-Allow-Origin', '*');
            console.log(`[Worker] CSS served successfully`);
            return newResponse;
          }
          return response;
        } else {
          console.error(`[Worker] Asset not found: ${pathname}, status: ${response.status}`);
        }
      } catch (err) {
        console.error('[Worker] Error serving static asset:', err);
      }
    }

    // Handle SPA routing for subpages
    let requestPath = pathname;
    
    // Remove trailing slash except for root
    if (requestPath !== '/' && requestPath.endsWith('/')) {
      requestPath = requestPath.slice(0, -1);
    }
    
    // Check if this is a known subpage
    if (requestPath !== '/' && SUBPAGES.has(requestPath.slice(1))) {
      console.log(`[Worker] Serving subpage: ${requestPath}`);
      // Try to serve the subpage's index.html
      const subpageRequest = new Request(new URL(`${requestPath}/index.html`, req.url), req);
      try {
        const subpageResponse = await env.ASSETS.fetch(subpageRequest);
        if (subpageResponse.status === 200) {
          console.log(`[Worker] Subpage served successfully: ${requestPath}`);
          return subpageResponse;
        } else {
          console.error(`[Worker] Subpage not found: ${requestPath}, status: ${subpageResponse.status}`);
        }
      } catch (err) {
        console.error('[Worker] Error serving subpage:', err);
      }
    }

    // Serve static assets (fallback to root index.html for 404s)
    try {
      const response = await env.ASSETS.fetch(req);
      if (response.status === 404 && requestPath !== '/') {
        console.log(`[Worker] 404 fallback to root for: ${requestPath}`);
        // For 404s on subpages, try to serve root index.html
        const rootRequest = new Request(new URL('/', req.url), req);
        return await env.ASSETS.fetch(rootRequest);
      }
      return response;
    } catch (err) {
      console.error('[Worker] Final fallback error:', err);
      // Final fallback to root index.html
      const rootRequest = new Request(new URL('/', req.url), req);
      return await env.ASSETS.fetch(rootRequest);
    }
  }
};


