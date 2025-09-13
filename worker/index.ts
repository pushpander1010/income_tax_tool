// UpTools Worker: Static site + /ai (LLM proxy) + /proxy (finance CORS bridge)

export interface Env {
  ASSETS: Fetcher;

  // Secrets
  PERPLEXITY_API_KEY: string;
  GROQ_API_KEY: string;
  GOOGLE_API_KEY: string;

  // Vars
  CORS_ORIGINS?: string;
  PROVIDER_DEFAULT?: "perplexity" | "groq" | "google";
  LOG_LEVEL?: "debug" | "info" | "warn" | "error";

  // Optional bases/models
  PPLX_BASE?: string;
  PPLX_MODEL?: string;
  GROQ_BASE?: string;
  GROQ_MODEL?: string;
  GOOGLE_GENAI_BASE?: string;
  GOOGLE_MODEL?: string;

  // Optional: allow-list extra finance hosts for /proxy (comma-separated)
  FINANCE_HOSTS?: string;
}

const enc = new TextEncoder();

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    // --- Finance CORS proxy (/proxy?u=<encoded target>) ---
    if (url.pathname === "/proxy") {
      return handleFinanceProxy(req, env);
    }

    // --- Serve your site (everything except /ai) ---
    if (url.pathname !== "/ai") {
      return serveSite(req, env);
    }

    // --- /ai: unified proxy for Perplexity, Groq, Gemini ---
    try {
      if (req.method === "OPTIONS") return corsPreflight(req, env);
      const cors = corsHeaders(req, env);

      if (req.method === "GET" && url.searchParams.get("health") === "1") {
        return new Response("ok", { headers: cors });
      }
      if (req.method !== "POST") {
        return new Response(JSON.stringify({ error: "Use POST" }), {
          status: 405,
          headers: { ...cors, "Content-Type": "application/json" }
        });
      }

      // parse
      let body: any;
      try { body = await req.json(); }
      catch { return json({ error: "Invalid JSON body" }, 400, cors); }

      const provider = (body.provider || env.PROVIDER_DEFAULT || "perplexity") as "perplexity" | "groq" | "google";
      const model = String(body.model || defaultModelFor(provider, env));
      const messages = Array.isArray(body.messages) ? body.messages : null;
      const temperature = clamp(Number(body.temperature ?? 0.4), 0, 2);
      const stream = body.stream !== false;

      if (!messages?.length) return json({ error: "messages[] required" }, 400, cors);
      if (!model) return json({ error: "model required" }, 400, cors);

      // Perplexity
      if (provider === "perplexity") {
        if (!env.PERPLEXITY_API_KEY) return json({ error: "PERPLEXITY_API_KEY missing" }, 500, cors);
        const endpoint = (env.PPLX_BASE || "https://api.perplexity.ai") + "/chat/completions";
        const up = { model, messages, temperature, stream };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.PERPLEXITY_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(up),
        });
        if (!res.ok) return relayJsonError(res, cors);
        if (!stream) return json(await res.json(), 200, cors);
        return translateOpenAIStyleSSE(res, cors);
      }

      // Groq
      if (provider === "groq") {
        if (!env.GROQ_API_KEY) return json({ error: "GROQ_API_KEY missing" }, 500, cors);
        const endpoint = (env.GROQ_BASE || "https://api.groq.com/openai/v1") + "/chat/completions";
        const up = { model, messages, temperature, stream };
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Authorization": `Bearer ${env.GROQ_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify(up),
        });
        if (!res.ok) return relayJsonError(res, cors);
        if (!stream) return json(await res.json(), 200, cors);
        return translateOpenAIStyleSSE(res, cors);
      }

      // Google Gemini 2.5
      if (provider === "google") {
        if (!env.GOOGLE_API_KEY) return json({ error: "GOOGLE_API_KEY missing" }, 500, cors);
        const base = env.GOOGLE_GENAI_BASE || "https://generativelanguage.googleapis.com/v1beta";
        const endpoint = `${base}/models/${encodeURIComponent(model)}:streamGenerateContent?key=${encodeURIComponent(env.GOOGLE_API_KEY)}`;
        const { systemInstruction, contents } = openAiToGemini(messages);
        const up: any = { contents, generationConfig: { temperature } };
        if (systemInstruction) up.systemInstruction = { parts: [{ text: systemInstruction }] };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(up),
        });
        if (!res.ok) return relayJsonError(res, cors);

        if (!stream) {
          const text = await collectGeminiStreamToText(res);
          return json(openAiStyleOnce(text), 200, cors);
        }
        return translateGeminiToOpenAISSE(res, cors);
      }

      return json({ error: `Unknown provider: ${provider}` }, 400, cors);
    } catch {
      return new Response("Internal Server Error", { status: 500, headers: { "Content-Type": "text/plain" } });
    }
  }
} satisfies ExportedHandler<Env>;

/* ---------------- Finance proxy ---------------- */

const DEFAULT_FINANCE_HOSTS = [
  "finance.yahoo.com",
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
  "mfapi.in",
  "api.mfapi.in",
  // Crypto + FX + fees + sentiment (public, CORS-friendly)
  "api.coincap.io",
  "api.exchangerate.host",
  "api.frankfurter.app",
  "mempool.space",
  "api.alternative.me",
  "api.coingecko.com",
];

function allowlistFromEnv(env: Env): string[] {
  const extra = (env.FINANCE_HOSTS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);
  const set = new Set<string>([...extra, ...DEFAULT_FINANCE_HOSTS]);
  return Array.from(set);
}
function isAllowedHost(hostname: string, env: Env): boolean {
  return allowlistFromEnv(env).some(suffix => hostname === suffix || hostname.endsWith("." + suffix));
}
function financeCorsHeaders(req: Request, env: Env): Record<string, string> {
  const base = corsHeaders(req, env); // Record<string,string>
  return {
    ...base,
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Expose-Headers": "Content-Type,Cache-Control,X-Proxy-Cache,X-Proxy-Host",
  };
}

async function handleFinanceProxy(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const cors = financeCorsHeaders(req, env);

  // Health check
  if (url.searchParams.get("health") === "1") {
    const payload = {
      ok: true,
      allow: allowlistFromEnv(env),
      cors_origin: cors["Access-Control-Allow-Origin"] ?? "*",
    };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...cors, "Content-Type": "application/json", "X-Robots-Tag": "noindex, nofollow" }
    });
  }

  // Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (!["GET", "HEAD"].includes(req.method)) {
    return new Response(JSON.stringify({ error: "Use GET/HEAD with ?u=<target>" }), {
      status: 405,
      headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  const targetRaw = url.searchParams.get("u") || url.searchParams.get("url");
  if (!targetRaw) {
    return new Response(JSON.stringify({ error: "Missing ?u=<encoded target url>" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  let target: URL;
  try { target = new URL(targetRaw); }
  catch {
    return new Response(JSON.stringify({ error: "Invalid target URL" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  if (!["http:", "https:"].includes(target.protocol)) {
    return new Response(JSON.stringify({ error: "Invalid protocol" }), {
      status: 400, headers: { ...cors, "Content-Type": "application/json" }
    });
  }
  if (!isAllowedHost(target.hostname, env)) {
    return new Response(JSON.stringify({ error: `Host not allowed: ${target.hostname}` }), {
      status: 403, headers: { ...cors, "Content-Type": "application/json" }
    });
  }

  // Optional nocache
  const noCache = url.searchParams.get("nocache") === "1";

  // Safe edge cache guard
  const edgeCache: Cache | undefined = (globalThis as any)?.caches?.default;

  // Build upstream request
  const upstreamReq = new Request(target.toString(), {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; UpToolsProxy/1.0; +https://www.uptools.in/)",
      "Accept": "application/json,text/plain,*/*",
      "Accept-Language": "en-IN,en;q=0.9",
      "Cache-Control": "no-cache",
    }
  });

  // Cache key
  const cacheKey = new Request(url.toString(), upstreamReq);

  let resp: Response | undefined;
  let cacheStatus: "HIT" | "MISS" = "MISS";

  if (edgeCache && !noCache) {
    try { resp = await edgeCache.match(cacheKey) as Response | undefined; } catch {}
    if (resp) cacheStatus = "HIT";
  }

  if (!resp) {
    const upstream = await fetch(upstreamReq, {
      cf: { cacheTtl: 300, cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "404": 60, "500-599": 0 } }
    });

    const headers = new Headers(upstream.headers);
    Object.entries(cors).forEach(([k, v]) => headers.set(k, v as string));
    headers.delete("content-security-policy");
    headers.delete("content-security-policy-report-only");
    headers.delete("clear-site-data");
    headers.delete("set-cookie");
    headers.delete("set-cookie2");
    headers.set("X-Proxy-Host", target.hostname);
    headers.set("X-Proxy-Cache", cacheStatus);
    headers.set("X-Robots-Tag", "noindex, nofollow");

    resp = new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers
    });

    if (edgeCache && upstream.ok && !noCache) {
      try { await edgeCache.put(cacheKey, resp.clone()); } catch {}
    }
  } else {
    // Ensure CORS/meta headers on cached hits
    const hdrs = new Headers(resp.headers);
    Object.entries(cors).forEach(([k, v]) => hdrs.set(k, v as string));
    hdrs.set("X-Proxy-Host", target.hostname);
    hdrs.set("X-Proxy-Cache", cacheStatus);
    hdrs.set("X-Robots-Tag", "noindex, nofollow");
    resp = new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: hdrs });
  }

  // HEAD should not return a body
  if (req.method === "HEAD") {
    return new Response(null, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
  }
  return resp;
}

/* ---------------- static site helpers ---------------- */

async function serveSite(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);

  // 1) Fix `/www` → `/`
  if (url.pathname === "/www" || url.pathname === "/www/") {
    url.pathname = "/";
    return Response.redirect(url.toString(), 301);
  }

  // 1b) Collapse duplicate slashes in path (e.g., `//about/` -> `/about/`)
  if (/\/{2,}/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/\/{2,}/g, "/");
    return Response.redirect(url.toString(), 301);
  }

  // 1c) Canonical redirects for renamed routes
  if (url.pathname === "/crypto-mining-calculator/" || url.pathname === "/crypto-mining-calculator") {
    url.pathname = "/crypto-profitability/";
    return Response.redirect(url.toString(), 301);
  }
  if (url.pathname === "/crypto-portfolio-tracker/" || url.pathname === "/crypto-portfolio-tracker") {
    url.pathname = "/crypto-portfolio/";
    return Response.redirect(url.toString(), 301);
  }

  // 2) Enforce trailing slash for directory-style routes: if no dot and no trailing slash, 301 to add '/'
  const hasDot = url.pathname.split("/").at(-1)?.includes(".") ?? false;
  const looksDir = !hasDot && !url.pathname.endsWith("/");
  if (looksDir) {
    const u2 = new URL(req.url);
    u2.pathname = u2.pathname + "/";
    return Response.redirect(u2.toString(), 301);
  }

  // 3) Try as-is from assets (and inject ads into HTML responses)
  let res = await env.ASSETS.fetch(req);
  if (res.status !== 404) {
    // Inject AdSense loader + a single ad slot on every HTML page if missing
    const ct = res.headers.get("Content-Type") || "";
    const isHTML = ct.includes("text/html");
    if (isHTML) {
      const html = await res.text();
      const hasLoader = html.includes("pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6216304334889617");
      const hasSlot = html.includes("class=\"adsbygoogle\"");
      const hasOrg = /"@type"\s*:\s*"Organization"/i.test(html);
      const loaderTag = `<script async src=\"https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-6216304334889617\" crossorigin=\"anonymous\"></script>`;
      const slotHtml = `\n  <ins class=\"adsbygoogle\" style=\"display:inline-block;width:500px;height:50px\" data-ad-client=\"ca-pub-6216304334889617\" data-ad-slot=\"9810172647\"></ins>\n  <script>(adsbygoogle=window.adsbygoogle||[]).push({});</script>\n`;
      const orgJson = `<script type=\"application/ld+json\">{\n  \"@context\": \"https://schema.org\",\n  \"@type\": \"Organization\",\n  \"name\": \"UpTools\",\n  \"url\": \"https://www.uptools.in/\",\n  \"logo\": \"https://www.uptools.in/assets/logo/uptools-logo.svg\"\n}</script>`;
      let out = html;
      if (!hasLoader) {
        out = out.replace(/<\/head>/i, `${loaderTag}\n</head>`);
      }
      if (!hasSlot) {
        out = out.replace(/<body(\s[^>]*)?>/i, (m) => `${m}\n${slotHtml}`);
      }
      if (!hasOrg) {
        out = out.replace(/<\/head>/i, `${orgJson}\n</head>`);
      }
      const hdrs = new Headers(res.headers);
      return new Response(out, { status: res.status, statusText: res.statusText, headers: hdrs });
    }
    return res;
  }

  // 4) If 404 and looks like a directory without slash (defense-in-depth), try with trailing slash
  if (!hasDot && !url.pathname.endsWith("/")) {
    const u2 = new URL(req.url);
    u2.pathname = u2.pathname + "/";
    res = await env.ASSETS.fetch(new Request(u2.toString(), req));
    if (res.status !== 404) return res;
  }

  // 5) Still 404 → if it's a browser navigation (HTML), 302 → homepage; otherwise keep the 404 for assets
  if (wantsHTML(req)) {
    const home = new URL(req.url);
    home.pathname = "/";
    home.search = "";
    return Response.redirect(home.toString(), 302);
  }

  return res; // non-HTML (assets) keep the 404
}

function wantsHTML(req: Request): boolean {
  if (req.method !== "GET") return false;
  const accept = req.headers.get("Accept") || "";
  return accept.includes("text/html");
}

/* ---------------- shared helpers ---------------- */

function corsPreflight(req: Request, env: Env): Response {
  const headers = corsHeaders(req, env);
  return new Response(null, { status: 204, headers });
}
function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowList = (env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  // If the exact origin is allowlisted, echo it; otherwise default to '*'
  const allowed = allowList.includes(origin) ? origin : "*";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };
}
function json(data: any, status = 200, extra: HeadersInit = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...extra } });
}
function clamp(n: number, min: number, max: number) { return isFinite(n) ? Math.min(max, Math.max(min, n)) : min; }
function defaultModelFor(provider: "perplexity" | "groq" | "google", env: Env) {
  if (provider === "perplexity") return env.PPLX_MODEL || "sonar";
  if (provider === "groq") return env.GROQ_MODEL || "llama-3.1-70b-versatile";
  return env.GOOGLE_MODEL || "gemini-2.5-flash";
}
function openAiToGemini(messages: Array<{ role: string; content: string }>) {
  let systemInstruction = "";
  const contents: any[] = [];
  for (const m of messages) {
    if (m.role === "system") { systemInstruction += (systemInstruction ? "\n" : "") + m.content; continue; }
    const role = m.role === "assistant" ? "model" : "user";
    contents.push({ role, parts: [{ text: m.content }] });
  }
  return { systemInstruction, contents };
}
async function relayJsonError(res: Response, cors: HeadersInit): Promise<Response> {
  let payload: any = { error: `${res.status} ${res.statusText}` };
  try { payload = await res.json(); } catch {}
  return json(payload, res.status, cors);
}
function translateOpenAIStyleSSE(upstream: Response, cors: HeadersInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const enqueue = (obj: any) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line || !line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (payload === "[DONE]") { controller.enqueue(enc.encode("data: [DONE]\n\n")); controller.close(); return; }
          try {
            const json = JSON.parse(payload);
            const delta = json?.choices?.[0]?.delta?.content ?? "";
            if (delta) enqueue({ choices: [{ delta: { content: delta } }] });
          } catch {}
        }
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" }
  });
}
function translateGeminiToOpenAISSE(upstream: Response, cors: HeadersInit): Response {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const enqueue = (text: string) =>
        controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`));
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let payload = line.startsWith("data:") ? line.slice(5).trim() : line;
          if (!payload) continue;
          if (payload === "[DONE]") {
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          try {
            const json = JSON.parse(payload);
            const parts = json?.candidates?.[0]?.content?.parts;
            if (Array.isArray(parts)) {
              let text = "";
              for (const p of parts) if (typeof p?.text === "string") text += p.text;
              if (text) enqueue(text);
            }
          } catch {}
        }
      }
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: { ...cors, "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" }
  });
}
async function collectGeminiStreamToText(upstream: Response): Promise<string> {
  const reader = upstream.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "", out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let payload = line.startsWith("data:") ? line.slice(5).trim() : line;
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const parts = json?.candidates?.[0]?.content?.parts;
        if (Array.isArray(parts)) for (const p of parts) if (typeof p?.text === "string") out += p.text;
      } catch {}
    }
  }
  return out;
}
function openAiStyleOnce(text: string) {
  return { id: "up-single", choices: [{ index: 0, message: { role: "assistant", content: text } }], usage: {} };
}
