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

    if (url.pathname === "/top10/daily.json") {
      return handleTop10Daily(req, env);
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

const PROXY_USER_AGENT = "Mozilla/5.0 (compatible; UpToolsProxy/1.0; +https://www.uptools.in/)";
const YAHOO_LOGIN_URL = "https://login.yahoo.com";
const YAHOO_CRUMB_URL = "https://query1.finance.yahoo.com/v1/test/getcrumb";
const YAHOO_CACHE_MS = 1000 * 60 * 30; // 30 minutes

type YahooAuth = { cookie: string; crumb: string; expires: number };
let yahooAuthCache: YahooAuth | null = null;
let yahooAuthPromise: Promise<YahooAuth> | null = null;

const splitSetCookie = (header: string): string[] => {
  const parts: string[] = [];
  let current = "";
  let inExpires = false;
  for (let i = 0; i < header.length; i++) {
    const ch = header[i];
    if (ch === ',') {
      if (inExpires) {
        current += ch;
      } else {
        parts.push(current.trim());
        current = "";
        while (i + 1 < header.length && header[i + 1] === ' ') i++;
      }
    } else {
      current += ch;
      const lower = current.toLowerCase();
      if (!inExpires && lower.endsWith('expires=')) {
        inExpires = true;
      } else if (inExpires && ch === ';') {
        inExpires = false;
      }
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
};

const collectYahooCookies = (headers: Headers): string[] => {
  const cookies: string[] = [];
  for (const [key, value] of headers) {
    if (key.toLowerCase() === 'set-cookie') {
      const first = value.split(';')[0]?.trim();
      if (first) cookies.push(first);
    }
  }
  if (!cookies.length) {
    const fallback = headers.get('set-cookie');
    if (fallback) {
      splitSetCookie(fallback).forEach(cookie => {
        const first = cookie.split(';')[0]?.trim();
        if (first) cookies.push(first);
      });
    }
  }
  return cookies;
};

const cookieHeaderFrom = (cookies: string[]): string =>
  cookies.map(c => c.split(';')[0]?.trim()).filter(Boolean).join('; ');

async function fetchYahooAuth(): Promise<YahooAuth> {
  const headers = {
    "User-Agent": PROXY_USER_AGENT,
    "Accept-Language": "en-US,en;q=0.9",
  };
  const loginRes = await fetch(YAHOO_LOGIN_URL, { headers });
  const cookieParts = collectYahooCookies(loginRes.headers);
  if (!cookieParts.length) throw new Error("Yahoo login returned no cookies");
  const cookie = cookieHeaderFrom(cookieParts);
  const crumbRes = await fetch(YAHOO_CRUMB_URL, { headers: { ...headers, cookie } });
  if (!crumbRes.ok) throw new Error(`Yahoo crumb status ${crumbRes.status}`);
  const crumb = (await crumbRes.text()).trim();
  if (!crumb) throw new Error("Yahoo crumb empty");
  return { cookie, crumb, expires: Date.now() + YAHOO_CACHE_MS };
}

async function getYahooAuth(force = false): Promise<YahooAuth> {
  if (force) {
    yahooAuthCache = null;
    yahooAuthPromise = null;
  } else if (yahooAuthCache && Date.now() < yahooAuthCache.expires) {
    return yahooAuthCache;
  }
  if (!yahooAuthPromise) {
    yahooAuthPromise = fetchYahooAuth().then(auth => {
      yahooAuthCache = auth;
      yahooAuthPromise = null;
      return auth;
    }).catch(err => {
      yahooAuthPromise = null;
      throw err;
    });
  }
  return yahooAuthPromise;
}

const YAHOO_AUTH_PATH = /\/v\d+\/finance\/(quote|quoteSummary|options|spark|screener|scan|chart)/;

function needsYahooAuth(target: URL): boolean {
  if (!target.hostname.endsWith("finance.yahoo.com")) return false;
  return YAHOO_AUTH_PATH.test(target.pathname);
}

function applyYahooAuth(
  target: URL,
  auth: YahooAuth | null,
  headers: Record<string, string>,
  rewrite?: { url: URL; key: string | null }
) {
  if (!auth) return;
  if (!target.searchParams.has("crumb") || target.searchParams.get("crumb") !== auth.crumb) {
    target.searchParams.set("crumb", auth.crumb);
    if (rewrite?.key && rewrite?.url) rewrite.url.searchParams.set(rewrite.key, target.toString());
  }
  headers["Cookie"] = auth.cookie;
}


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

  const hasU = url.searchParams.has("u");
  const hasUrl = url.searchParams.has("url");
  const targetKey = hasU ? "u" : hasUrl ? "url" : null;
  const targetRaw = targetKey ? url.searchParams.get(targetKey) : null;
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

  const needsYahoo = needsYahooAuth(target);
  let yahooAuth: YahooAuth | null = null;
  if (needsYahoo) {
    try {
      yahooAuth = await getYahooAuth();
    } catch (err) {
      console.warn("Yahoo auth fetch failed", err);
    }
  }

  const upstreamHeaders: Record<string, string> = {
    "User-Agent": PROXY_USER_AGENT,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Cache-Control": "no-cache",
  };
  applyYahooAuth(target, yahooAuth, upstreamHeaders, { url, key: targetKey });

  const makeUpstreamRequest = () => new Request(target.toString(), {
    method: "GET",
    headers: upstreamHeaders,
  });

  const useCache = edgeCache && !noCache && !needsYahoo;
  let upstreamReq = makeUpstreamRequest();
  const cacheKey = new Request(url.toString(), upstreamReq);

  let resp: Response | undefined;
  let cacheStatus: "HIT" | "MISS" = "MISS";

  if (useCache) {
    try { resp = await edgeCache.match(cacheKey) as Response | undefined; } catch {}
    if (resp) cacheStatus = "HIT";
  }

  if (!resp) {
    let upstream = await fetch(upstreamReq, {
      cf: { cacheTtl: 300, cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "404": 60, "500-599": 0 } }
    });

    if (needsYahoo && upstream.status === 401) {
      try {
        yahooAuth = await getYahooAuth(true);
        applyYahooAuth(target, yahooAuth, upstreamHeaders, { url, key: targetKey });
        upstreamReq = makeUpstreamRequest();
        upstream = await fetch(upstreamReq, {
          cf: { cacheTtl: 300, cacheEverything: true, cacheTtlByStatus: { "200-299": 300, "404": 60, "500-599": 0 } }
        });
      } catch (err) {
        console.warn("Yahoo auth refresh failed", err);
      }
    }

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

    if (useCache && edgeCache && upstream.ok) {
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

/* ---------------- daily top10 aggregator ---------------- */

interface DailyPick {
  symbol: string;
  name: string;
  currency: string;
  price: number | null;
  plan: {
    entry: number | null;
    stop: number | null;
    t1: number | null;
    t2: number | null;
    note: string;
  };
  scores: {
    ta: number;
    fa: number;
    news: number;
    volume: number;
    total: number;
  };
  metrics: {
    rsi: number | null;
    sma50: number | null;
    sma200: number | null;
    support: number | null;
    resistance: number | null;
    volumeShock: number | null;
    averageVolume: number | null;
    lastVolume: number | null;
    newsNet: number;
  };
  why: string;
  news: string[];
  dataTimestamp: string | null;
}

interface MarketDailyResult {
  picks: DailyPick[];
  scanned: number;
  processed: number;
  failed: number;
  runtimeMs: number;
  universe: string;
  notes: string[];
}

interface DailyPayload {
  generatedAt: string;
  nextUpdateAt: string;
  runtimeMs: number;
  markets: Record<string, MarketDailyResult>;
  metadata: {
    markets: string[];
    candidateLimit: number;
    components: string[];
    newsFetchLimit: number;
  };
}

const DAILY_MARKETS = ["NSE", "BSE", "NASDAQ", "NYSE", "LSE", "TSX", "TSE", "SSE", "HKEX", "FWB"] as const;
const DAILY_CANDIDATE_LIMIT = 15;
const DAILY_TOP_EXPORT = 20;
const DAILY_REFRESH_INTERVAL_MS = 1000 * 60 * 60 * 24;
const TOP10_CACHE_KEY = "__uptools_top10_daily__";
const DAILY_QUOTE_CHUNK = 15;
const DAILY_SPARK_CHUNK = 8;
const NEWS_FETCH_LIMIT = 1;

let top10Cache: { payload: DailyPayload; expires: number } | null = null;
let top10Promise: Promise<DailyPayload> | null = null;

const suffixByMarketDaily: Record<string, string> = {
  NSE: ".NS",
  BSE: ".BO",
  NASDAQ: "",
  NYSE: "",
  LSE: ".L",
  TSX: ".TO",
  TSE: ".T",
  SSE: ".SS",
  HKEX: ".HK",
  FWB: ".F",
};

const regionByMarketDaily: Record<string, string> = {
  NSE: "IN",
  BSE: "IN",
  NASDAQ: "US",
  NYSE: "US",
  LSE: "GB",
  TSX: "CA",
  TSE: "JP",
  SSE: "CN",
  HKEX: "HK",
  FWB: "DE",
};

const POS_WORDS = [
  "beats",
  "surge",
  "record",
  "profit",
  "upgrade",
  "outperform",
  "gain",
  "buy",
  "rally",
  "soars",
  "strong",
  "approval",
  "order win",
  "deal",
  "guidance",
  "raise",
  "dividend",
  "partnership",
  "contracts",
  "momentum",
  "breakout"
];

const NEG_WORDS = [
  "miss",
  "plunge",
  "loss",
  "downgrade",
  "underperform",
  "fall",
  "sell",
  "lawsuit",
  "probe",
  "delay",
  "weak",
  "recall",
  "fraud",
  "ban",
  "strike",
  "cut",
  "slump",
  "guidance cut",
  "downtime",
  "penalty"
];

const numberFormatDaily = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

function scoreHeadlineText(title: string): number {
  const text = (title || "").toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POS_WORDS) if (text.includes(w)) pos++;
  for (const w of NEG_WORDS) if (text.includes(w)) neg++;
  return pos - neg;
}

const SMA = (arr: Array<number | null>, n: number) =>
  arr.map((_, i) => {
    if (i + 1 < n) return null;
    const slice = arr.slice(i - n + 1, i + 1);
    const sum = slice.reduce<number>((acc, val) => acc + (val ?? 0), 0);
    return sum / n;
  });

const RSI = (closes: Array<number | null>, n = 14) => {
  let gains = 0,
    losses = 0;
  const out = new Array(closes.length).fill(null);
  for (let i = 1; i < closes.length; i++) {
    const current = closes[i] ?? closes[i - 1] ?? 0;
    const prev = closes[i - 1] ?? closes[i] ?? 0;
    const change = current - prev;
    const gain = Math.max(change, 0);
    const loss = Math.max(-change, 0);
    if (i <= n) {
      gains += gain;
      losses += loss;
      if (i === n) {
        const rs = gains / Math.max(1e-9, losses);
        out[i] = 100 - 100 / (1 + rs);
      }
    } else {
      gains = (gains * (n - 1) + gain) / n;
      losses = (losses * (n - 1) + loss) / n;
      const rs = gains / Math.max(1e-9, losses);
      out[i] = 100 - 100 / (1 + rs);
    }
  }
  return out;
};

const supportResistance = (closes: Array<number | null>, look = 30) => {
  const filtered = closes.filter((v) => v != null) as number[];
  if (!filtered.length) return { support: null, resistance: null };
  const window = filtered.slice(-look);
  let hi = -Infinity;
  let lo = Infinity;
  for (const v of window) {
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  return {
    support: Number.isFinite(lo) ? lo : null,
    resistance: Number.isFinite(hi) ? hi : null,
  };
};



function chunkSymbols(list: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < list.length; i += size) {
    out.push(list.slice(i, i + size));
  }
  return out;
}

function formatNumberDaily(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "n/a";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: digits }).format(value);
}

async function handleTop10Daily(req: Request, env: Env): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "Use GET or HEAD" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET, HEAD" },
    });
  }
  try {
    const payload = await getDailyPayload(env);
    const headers: Record<string, string> = {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=900, s-maxage=3600",
      "X-Generated-At": payload.generatedAt,
      "X-Next-Update": payload.nextUpdateAt,
    };
    if (req.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(JSON.stringify(payload), { status: 200, headers });
  } catch (err) {
    console.error("top10 daily error", err);
    const message = err instanceof Error ? err.message : "Failed to build daily picks";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

async function getDailyPayload(env: Env, force = false): Promise<DailyPayload> {
  const now = Date.now();
  if (!force && top10Cache && now < top10Cache.expires) {
    return top10Cache.payload;
  }

  if (!force) {
    const cache = (globalThis as any)?.caches?.default as Cache | undefined;
    if (cache) {
      try {
        const cacheRequest = new Request(`https://cache.uptools/${TOP10_CACHE_KEY}`);
        const cached = await cache.match(cacheRequest);
        if (cached) {
          const payload = (await cached.json()) as DailyPayload;
          const expiry = Date.parse(payload.nextUpdateAt || "") || now + DAILY_REFRESH_INTERVAL_MS;
          top10Cache = { payload, expires: expiry };
          return payload;
        }
      } catch (err) {
        console.warn("daily cache read failed", err);
      }
    }
  }

  if (!top10Promise) {
    top10Promise = (async () => {
      const payload = await computeDailyPayload(env);
      const expiry = Date.parse(payload.nextUpdateAt || "") || Date.now() + DAILY_REFRESH_INTERVAL_MS;
      top10Cache = { payload, expires: expiry };
      const cache = (globalThis as any)?.caches?.default as Cache | undefined;
      if (cache) {
        const cacheRequest = new Request(`https://cache.uptools/${TOP10_CACHE_KEY}`);
        try {
          await cache.put(
            cacheRequest,
            new Response(JSON.stringify(payload), {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=86400, s-maxage=86400",
              },
            })
          );
        } catch (err) {
          console.warn("daily cache write failed", err);
        }
      }
      return payload;
    })();
  }

  try {
    return await top10Promise;
  } finally {
    top10Promise = null;
  }
}

async function computeDailyPayload(_env: Env): Promise<DailyPayload> {
  const started = Date.now();
  const markets: Record<string, MarketDailyResult> = {};
  for (const market of DAILY_MARKETS) {
    markets[market] = await processMarketDaily(market);
  }
  const generatedAt = new Date().toISOString();
  const nextUpdateAt = new Date(Date.now() + DAILY_REFRESH_INTERVAL_MS).toISOString();
  return {
    generatedAt,
    nextUpdateAt,
    runtimeMs: Date.now() - started,
    markets,
    metadata: {
      markets: [...DAILY_MARKETS],
      candidateLimit: DAILY_CANDIDATE_LIMIT,
      components: ["ta", "fa", "news", "volume"],
      newsFetchLimit: NEWS_FETCH_LIMIT,
    },
  };
}

interface SymbolInputs {
  symbol: string;
  quote: any;
  chart: { closes: Array<number | null>; volumes: Array<number | null>; meta: any };
  name: string;
  newsNet: number;
  newsTitles: string[];
}

function buildPick(input: SymbolInputs): DailyPick | null {
  const { symbol, quote, chart, name, newsNet, newsTitles } = input;
  const closes = chart.closes;
  if (!closes.some((v) => v != null)) return null;

  const evaluation = makeScoresDaily({ closes, volumes: chart.volumes, quote, newsNet });
  const lastPriceCandidate = closes.filter((v) => v != null).at(-1) ?? null;
  const price = quote?.regularMarketPrice ?? (lastPriceCandidate as number | null);

  return {
    symbol,
    name,
    currency: quote?.currency || chart.meta?.currency || "",
    price: typeof price === "number" ? price : null,
    plan: evaluation.plan,
    scores: evaluation.scores,
    metrics: {
      rsi: evaluation.tech.rsi,
      sma50: evaluation.tech.sma50,
      sma200: evaluation.tech.sma200,
      support: evaluation.tech.support,
      resistance: evaluation.tech.resistance,
      volumeShock: evaluation.volumeShock,
      averageVolume: evaluation.avgVolume,
      lastVolume: evaluation.lastVolume,
      newsNet,
    },
    why: evaluation.why,
    news: newsTitles.slice(0, 3),
    dataTimestamp: chart.meta?.regularMarketTime ? new Date(chart.meta.regularMarketTime * 1000).toISOString() : null,
  };
}

async function processMarketDaily(market: string): Promise<MarketDailyResult> {
  const started = Date.now();
  const symbols = await buildCandidateSymbols(market);
  const uppercaseSymbols = symbols.map((s) => s.toUpperCase());
  const picks: DailyPick[] = [];
  const dataBySymbol = new Map<string, SymbolInputs>();
  let processed = 0;
  let failed = 0;

  const quotesMap = await fetchQuotesBatch(uppercaseSymbols);
  const sparkMap = await fetchSparkBatch(uppercaseSymbols);

  for (const symbolRaw of uppercaseSymbols) {
    const quote = quotesMap.get(symbolRaw);
    const chart = sparkMap.get(symbolRaw);
    if (!quote || !chart) {
      failed++;
      continue;
    }
    const name = quote?.shortName || quote?.longName || chart.meta?.shortName || symbolRaw;
    const inputs: SymbolInputs = {
      symbol: symbolRaw,
      quote,
      chart,
      name,
      newsNet: 0,
      newsTitles: [],
    };
    const pick = buildPick(inputs);
    if (pick) {
      dataBySymbol.set(symbolRaw, inputs);
      picks.push(pick);
      processed++;
    } else {
      failed++;
    }
  }

  picks.sort((a, b) => b.scores.total - a.scores.total);

  const newsTargets = picks.slice(0, Math.min(NEWS_FETCH_LIMIT, picks.length));
  for (const target of newsTargets) {
    const data = dataBySymbol.get(target.symbol.toUpperCase());
    if (!data) continue;
    try {
      const news = await fetchNewsDaily(data.name);
      data.newsTitles = news.titles;
      data.newsNet = news.net;
      const updated = buildPick(data);
      if (updated) {
        const index = picks.findIndex((p) => p.symbol === updated.symbol);
        if (index >= 0) picks[index] = updated;
      }
    } catch (err) {
      console.warn(`news fetch failed ${target.symbol}`, err);
    }
  }

  picks.sort((a, b) => b.scores.total - a.scores.total);
  const selected = picks.slice(0, Math.min(DAILY_TOP_EXPORT, picks.length));

  return {
    picks: selected,
    scanned: uppercaseSymbols.length,
    processed,
    failed,
    runtimeMs: Date.now() - started,
    universe: "Yahoo most actives",
    notes: [
      "Scores combine technicals, valuation, news tone, and volume shock.",
      `News deep-dive limited to top ${NEWS_FETCH_LIMIT} symbols per market to stay within worker limits.`,
    ],
  };
}

async function buildCandidateSymbols(market: string): Promise<string[]> {
  const region = regionByMarketDaily[market] || "US";
  const suffix = suffixByMarketDaily[market] ?? "";
  const baseUrl = "https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved";
  const data = await fetchYahooJson(
    `${baseUrl}?scrIds=most_actives&count=${DAILY_CANDIDATE_LIMIT}&start=0&lang=en-US&region=${region}`
  );
  const quotes = (data?.finance?.result?.[0]?.quotes || []) as Array<{ symbol?: string }>;
  const normalized = quotes
    .map((q) => (q?.symbol || '').toUpperCase())
    .filter(Boolean)
    .map((sym) => {
      if (!suffix) return sym;
      return sym.endsWith(suffix) ? sym : `${sym}${suffix}`;
    });
  return dedupeSymbols(normalized).slice(0, DAILY_CANDIDATE_LIMIT);
}

function dedupeSymbols(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const sym of list) {
    if (!sym) continue;
    if (seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out;
}

async function fetchQuotesBatch(symbols: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (const chunk of chunkSymbols(symbols, DAILY_QUOTE_CHUNK)) {
    if (!chunk.length) continue;
    const data = await fetchYahooJson(
      `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(chunk.join(','))}`
    );
    const results = (data?.quoteResponse?.result || []) as Array<any>;
    for (const quote of results) {
      const key = (quote?.symbol || '').toUpperCase();
      if (key) map.set(key, quote);
    }
  }
  return map;
}

async function fetchSparkBatch(symbols: string[]): Promise<Map<string, { closes: Array<number | null>; volumes: Array<number | null>; meta: any }>> {
  const map = new Map<string, { closes: Array<number | null>; volumes: Array<number | null>; meta: any }>();
  for (const chunk of chunkSymbols(symbols, DAILY_SPARK_CHUNK)) {
    if (!chunk.length) continue;
    const data = await fetchYahooJson(
      `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(chunk.join(','))}&range=6mo&interval=1d`
    );
    const results = (data?.spark?.result || []) as Array<any>;
    for (const entry of results) {
      const key = (entry?.symbol || '').toUpperCase();
      const response = entry?.response?.[0];
      const quote = response?.indicators?.quote?.[0];
      if (!key || !response || !quote) continue;
      const closes = Array.isArray(quote?.close) ? quote.close : [];
      const volumes = Array.isArray(quote?.volume) ? quote.volume : [];
      map.set(key, { closes, volumes, meta: response?.meta || {} });
    }
  }
  return map;
}

async function fetchNewsDaily(name: string): Promise<{ titles: string[]; net: number }> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(name + ' stock OR shares')}&hl=en-IN&gl=IN&ceid=IN:en`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": PROXY_USER_AGENT,
      "Accept": "application/rss+xml,text/xml,text/plain",
      "Accept-Language": "en-IN,en;q=0.9",
    },
  });
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const text = await res.text();
  const titles = [...text.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .slice(0, 6)
    .map((match) => {
      const block = match[1];
      const viaCdata = block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/);
      if (viaCdata?.[1]) return viaCdata[1];
      const plain = block.match(/<title>(.*?)<\/title>/);
      return plain?.[1] || '';
    })
    .filter(Boolean);
  const net = titles.reduce((sum, title) => sum + scoreHeadlineText(title), 0);
  return { titles, net };
}

async function fetchYahooJson(targetUrl: string): Promise<any> {
  const res = await fetchYahooResponse(targetUrl);
  if (!res.ok) {
    throw new Error(`Yahoo HTTP ${res.status}`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

async function fetchYahooResponse(targetUrl: string): Promise<Response> {
  const target = new URL(targetUrl);
  const headers: Record<string, string> = {
    "User-Agent": PROXY_USER_AGENT,
    "Accept": "application/json,text/plain,*/*",
    "Accept-Language": "en-IN,en;q=0.9",
    "Cache-Control": "no-cache",
  };
  let auth: YahooAuth | null = null;
  if (needsYahooAuth(target)) {
    auth = await getYahooAuth();
    applyYahooAuth(target, auth, headers);
  }
  let req = new Request(target.toString(), { headers });
  let res = await fetch(req);
  if (needsYahooAuth(target) && res.status === 401) {
    auth = await getYahooAuth(true);
    applyYahooAuth(target, auth, headers);
    req = new Request(target.toString(), { headers });
    res = await fetch(req);
  }
  return res;
}

function makeScoresDaily(params: {
  closes: Array<number | null>;
  volumes: Array<number | null>;
  quote: any;
  newsNet: number;
}): {
  scores: { ta: number; fa: number; news: number; volume: number; total: number };
  plan: { entry: number | null; stop: number | null; t1: number | null; t2: number | null; note: string };
  tech: { rsi: number | null; sma50: number | null; sma200: number | null; support: number | null; resistance: number | null };
  volumeShock: number | null;
  avgVolume: number | null;
  lastVolume: number | null;
  why: string;
} {
  const closes = params.closes;
  const last = closes.filter((v) => v != null).at(-1) as number | null;
  const sma50Arr = SMA(closes, 50);
  const sma200Arr = SMA(closes, 200);
  const rsiArr = RSI(closes, 14);
  const sr = supportResistance(closes, 30);
  const sma50 = sma50Arr.at(-1) as number | null;
  const sma200 = sma200Arr.at(-1) as number | null;
  const rsi = rsiArr.at(-1) as number | null;

  let ta = 0;
  if (last != null && sma50 != null) ta += last > sma50 ? 1 : -1;
  if (sma50 != null && sma200 != null) ta += sma50 > sma200 ? 1 : -1;
  if (rsi != null && rsi >= 45 && rsi <= 65) ta += 1;
  if (rsi != null && rsi > 70) ta -= 1;
  if (sr.resistance != null && last != null && last > sr.resistance) ta += 1;
  if (sr.support != null && last != null && last < sr.support) ta -= 1;

  let fa = 0;
  const pe = params.quote?.trailingPE;
  const dy = params.quote?.trailingAnnualDividendYield;
  if (pe && pe >= 8 && pe <= 25) fa += 1;
  if (pe && pe > 35) fa -= 1;
  if (dy && dy * 100 >= 1) fa += 1;

  const newsScore = clamp(params.newsNet, -2, 2);

  const volValues = params.volumes.filter((v) => v != null && Number.isFinite(v)) as number[];
  const lastVolume = volValues.at(-1) ?? null;
  const history = volValues.slice(-11, -1);
  const avgVolume = history.length ? history.reduce((acc, v) => acc + v, 0) / history.length : null;
  const volumeShock = lastVolume != null && avgVolume ? lastVolume / avgVolume : null;
  let volumeScore = 0;
  if (volumeShock != null) {
    if (volumeShock >= 1.5) volumeScore = 1;
    else if (volumeShock <= 0.7) volumeScore = -1;
  }

  const total = ta + fa + newsScore + volumeScore;

  let entry: number | null = null;
  let stop: number | null = null;
  let t1: number | null = null;
  let t2: number | null = null;
  let planNote = "";

  if (sr.support != null && sr.resistance != null && last != null) {
    const breakout = last > sr.resistance;
    if (breakout) {
      entry = sr.resistance * 1.005;
      stop = sr.resistance * 0.98;
      const risk = entry - stop;
      t1 = entry + 1.5 * risk;
      t2 = entry + 2.5 * risk;
      planNote = "Breakout retest";
    } else {
      entry = sr.support * 1.01;
      stop = sr.support * 0.985;
      const risk = entry - stop;
      t1 = entry + 1.5 * risk;
      t2 = entry + 2.5 * risk;
      planNote = "Support bounce";
    }
  }

  const whyParts = [
    last != null && sma50 != null ? `Price ${last > sma50 ? 'above' : 'below'} SMA50` : null,
    sma50 != null && sma200 != null ? `SMA50 ${sma50 > sma200 ? '>' : '<'} SMA200` : null,
    rsi != null ? `RSI ${numberFormatDaily.format(rsi)}` : null,
    sr.support != null ? `Support ${formatNumberDaily(sr.support)}` : null,
    sr.resistance != null ? `Resistance ${formatNumberDaily(sr.resistance)}` : null,
    pe ? `PE ${formatNumberDaily(pe)}` : null,
    dy ? `Div ${formatNumberDaily(dy * 100, 1)}%` : null,
    newsScore ? `News ${newsScore >= 0 ? '+' : ''}${newsScore}` : null,
    volumeShock != null ? `Vol ${formatNumberDaily(volumeShock, 2)}x avg` : null,
  ].filter(Boolean).join(' � ');

  return {
    scores: { ta, fa, news: newsScore, volume: volumeScore, total },
    plan: { entry, stop, t1, t2, note: planNote },
    tech: { rsi, sma50, sma200, support: sr.support, resistance: sr.resistance },
    volumeShock,
    avgVolume,
    lastVolume,
    why: whyParts,
  };
}
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
  if (url.pathname === "/plagiarism-checker/" || url.pathname === "/plagiarism-checker") {
    url.pathname = "/ai-plagiarism/";
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
  // If missing OG image under /assets/og/, serve default
  if (url.pathname.startsWith('/assets/og/')) {
    const def = new URL(req.url);
    def.pathname = '/assets/og/default.png';
    const fallback = await env.ASSETS.fetch(new Request(def.toString(), req));
    if (fallback.ok) {
      const hdrs = new Headers(fallback.headers);
      hdrs.set('Content-Type', 'image/png');
      hdrs.set('Cache-Control', 'public, max-age=31536000, immutable');
      return new Response(fallback.body, { status: 200, headers: hdrs });
    }
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



