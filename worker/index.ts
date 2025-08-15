/// <reference lib="WebWorker" />
/// <reference types="@cloudflare/workers-types" />

import type { RequestInitCfProperties } from "@cloudflare/workers-types";

// Helper so TS accepts the `cf` key on RequestInit
const withCF = (init: RequestInit & { cf?: RequestInitCfProperties }) => init;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    // HTML: don’t cache at edge, rely on browser revalidation headers
    if (pathname === "/" || pathname.endsWith(".html")) {
      return fetch(request, withCF({ cf: { cacheEverything: false, cacheTtl: 0 } }));
    }

    // Root CSS: 1h at edge + SWR for browsers
    if (pathname === "/style.css") {
      const res = await fetch(request, withCF({ cf: { cacheEverything: true, cacheTtl: 3600 } }));
      const h = new Headers(res.headers);
      h.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }

    // Fingerprinted static assets
    if (pathname.startsWith("/assets/")) {
      const res = await fetch(request, withCF({ cf: { cacheEverything: true, cacheTtl: 31536000 } }));
      const h = new Headers(res.headers);
      h.set("Cache-Control", "public, max-age=31536000, immutable");
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }

    // Default passthrough
    return fetch(request);
  },
} satisfies ExportedHandler;
