import type { Env } from "./index";

export type SpecificMediaPlatform = "instagram" | "youtube" | "twitter" | "facebook" | "tiktok";
export type MediaPlatform = SpecificMediaPlatform | "generic";

export type MediaItemType = "video" | "image" | "audio" | "document" | "playlist" | "stream";

export interface MediaItem {
  type: MediaItemType;
  quality?: string;
  mime?: string;
  size?: number;
  url: string;
}

export interface MediaPayload {
  type: "video" | "image" | "carousel" | "story" | "audio" | "stream";
  author?: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  thumb?: string;
  items: MediaItem[];
  source?: string;
}

export interface MediaResolution {
  platform: MediaPlatform;
  payload: MediaPayload;
}

type ResolverFn = (target: URL, env: Env, platform: MediaPlatform) => Promise<MediaPayload>;

export class MediaResolverError extends Error {
  status: number;
  platform?: MediaPlatform;
  constructor(message: string, status = 500, platform?: MediaPlatform) {
    super(message);
    this.name = "MediaResolverError";
    this.status = status;
    this.platform = platform;
  }
}

const PLATFORM_HOSTS: Record<SpecificMediaPlatform, RegExp[]> = {
  instagram: [/\.instagram\.com$/i, /^instagr\.am$/i, /\.threads\.net$/i],
  youtube: [/\.youtube\.com$/i, /^youtu\.be$/i],
  twitter: [/\.twitter\.com$/i, /\.x\.com$/i],
  facebook: [/\.facebook\.com$/i, /^fb\.watch$/i],
  tiktok: [/\.tiktok\.com$/i],
};

const MEDIA_RESOLVERS: Record<MediaPlatform, ResolverFn> = {
  instagram: resolveInstagram,
  youtube: resolveYouTube,
  twitter: resolveGenericOpenGraph,
  facebook: resolveGenericOpenGraph,
  tiktok: resolveGenericOpenGraph,
  generic: resolveGenericOpenGraph,
};

const PLATFORM_ALIASES: Record<string, MediaPlatform> = {
  ig: "instagram",
  insta: "instagram",
  instagram: "instagram",
  reels: "instagram",
  threads: "instagram",
  yt: "youtube",
  youtube: "youtube",
  youtu: "youtube",
  fb: "facebook",
  facebook: "facebook",
  meta: "facebook",
  tw: "twitter",
  twitter: "twitter",
  x: "twitter",
  tiktok: "tiktok",
  tt: "tiktok",
};

const DEFAULT_BROWSER_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
};

export async function resolveMedia(target: URL, platformHint: string | undefined, env: Env): Promise<MediaResolution> {
  const platform = detectMediaPlatform(target, platformHint);
  const resolver = MEDIA_RESOLVERS[platform];
  if (!resolver) {
    throw new MediaResolverError("Unsupported platform", 422, platform);
  }
  try {
    const payload = await resolver(target, env, platform);
    payload.items = dedupeMediaItems(payload.items);
    await enrichMediaItems(payload.items);
    if (!payload.thumb) {
      const fallback = payload.items.find((item) => item.type === "image");
      if (fallback) payload.thumb = fallback.url;
    }
    return { platform, payload };
  } catch (error) {
    if (error instanceof MediaResolverError) {
      if (!error.platform) error.platform = platform;
      throw error;
    }
    const wrapped = new MediaResolverError("Failed to resolve media", 502, platform);
    (wrapped as any).cause = error;
    throw wrapped;
  }
}

function detectMediaPlatform(target: URL, hint?: string): MediaPlatform {
  if (hint) {
    const alias = PLATFORM_ALIASES[hint.toLowerCase()];
    if (alias) return alias;
  }
  const host = target.hostname.toLowerCase();
  for (const platform of Object.keys(PLATFORM_HOSTS) as SpecificMediaPlatform[]) {
    const patterns = PLATFORM_HOSTS[platform];
    if (patterns.some((pattern) => pattern.test(host))) {
      return platform;
    }
  }
  return "generic";
}

async function resolveGenericOpenGraph(target: URL, _env: Env, platform: MediaPlatform): Promise<MediaPayload> {
  const extracted = await extractMediaMetadata(target);
  const payload = buildPayloadFromMetadata(target, extracted);
  if (!payload.items.length) {
    throw new MediaResolverError("No downloadable media found", 404, platform);
  }
  return payload;
}

async function resolveInstagram(target: URL, _env: Env, platform: MediaPlatform): Promise<MediaPayload> {
  const extracted = await extractMediaMetadata(target);
  if (isInstagramUnavailablePage(extracted.html)) {
    throw new MediaResolverError(
      "Instagram is asking for a login to view this post. Only public links can be downloaded.",
      451,
      platform
    );
  }
  const payload = buildPayloadFromMetadata(target, extracted);
  augmentInstagramPayload(extracted.html, payload);
  if (!payload.items.length) {
    throw new MediaResolverError(
      "We couldn't extract any downloadable file from this Instagram link. It may be private or unsupported.",
      404,
      platform
    );
  }
  if (target.pathname.includes("/stories/")) {
    payload.type = "story";
  } else if (payload.type === "image") {
    const mediaCount = payload.items.filter((item) => item.type === "image" || item.type === "video").length;
    if (mediaCount > 1) payload.type = payload.items.some((item) => item.type === "video") ? "carousel" : "image";
  }
  payload.source = payload.source ? `${payload.source},instagram` : "instagram";
  return payload;
}

async function resolveYouTube(target: URL, env: Env, platform: MediaPlatform): Promise<MediaPayload> {
  const videoId = extractYouTubeId(target);
  if (!videoId) {
    throw new MediaResolverError("Unsupported YouTube URL", 422, platform);
  }
  const base = (env.YT_RESOLVER_BASE || "https://piped.video").replace(/\/$/, "");
  const res = await fetch(`${base}/api/v1/streams/${videoId}`);
  if (!res.ok) {
    throw new MediaResolverError(`Failed to fetch YouTube streams (${res.status})`, res.status, platform);
  }
  const data = await res.json<any>();
  const items: MediaItem[] = [];
  const addItem = createMediaItemAdder(items);
  for (const stream of data.videoStreams || []) {
    const quality = typeof stream.quality === "string" ? stream.quality : stream.height ? `${stream.height}p` : undefined;
    const mime = typeof stream.mimeType === "string" ? stream.mimeType.split(';')[0] : undefined;
    const size = stream.contentLength ? Number(stream.contentLength) : undefined;
    addItem(stream.url, "video", quality, mime, size);
  }
  for (const stream of data.audioStreams || []) {
    const quality = stream.bitrate ? `${Math.round(stream.bitrate / 1000)}kbps` : stream.quality;
    const mime = typeof stream.mimeType === "string" ? stream.mimeType.split(';')[0] : undefined;
    const size = stream.contentLength ? Number(stream.contentLength) : undefined;
    addItem(stream.url, "audio", quality, mime, size);
  }
  if (!items.length && data.hls) {
    const hlsUrl = typeof data.hls === "string" ? data.hls : data.hls.url ?? undefined;
    addItem(hlsUrl, "stream", "HLS", "application/vnd.apple.mpegurl");
  }
  if (!items.length) {
    throw new MediaResolverError("No downloadable streams returned", 404, platform);
  }
  const thumbnail = Array.isArray(data.thumbnails) && data.thumbnails.length
    ? data.thumbnails[data.thumbnails.length - 1].url
    : data.thumbnailUrl || data.thumbnail;
  const publishedAt = normalizeDate(data.uploadDate || data.published || data.date);
  return {
    type: items.some((item) => item.type === "video") ? "video" : items.some((item) => item.type === "audio") ? "audio" : "stream",
    author: data.uploader || data.channel?.name || data.author,
    title: data.title || data.name,
    description: typeof data.description === "string" ? data.description : undefined,
    publishedAt,
    thumb: thumbnail ? normalizeMediaUrl(thumbnail) : undefined,
    items,
    source: base,
  };
}

interface ExtractedMetadata {
  html: string;
  meta: Record<string, string[]>;
  jsonld: any[];
}

async function extractMediaMetadata(target: URL): Promise<ExtractedMetadata> {
  const html = await fetchMediaDocument(target);
  return {
    html,
    meta: parseMetaTags(html),
    jsonld: extractJsonLd(html),
  };
}

async function fetchMediaDocument(target: URL): Promise<string> {
  try {
    const res = await fetch(target.toString(), { headers: DEFAULT_BROWSER_HEADERS });
    if (res.ok) return await res.text();
    if (res.status === 403 || res.status === 404) {
      const fallback = await fetch(`https://r.jina.ai/${target.toString()}`, { headers: DEFAULT_BROWSER_HEADERS });
      if (fallback.ok) return await fallback.text();
    }
    throw new MediaResolverError(`Failed to fetch source (${res.status})`, res.status);
  } catch (error) {
    if (error instanceof MediaResolverError) throw error;
    throw new MediaResolverError("Network error while fetching source", 502);
  }
}

function parseMetaTags(html: string): Record<string, string[]> {
  const meta: Record<string, string[]> = {};
  const regex = /<meta\s+(?:name|property)=["']?([^"'>\s]+)["']?[^>]*?content=["']?([^"'>]+)["']?[^>]*?>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const key = match[1].toLowerCase();
    const value = decodeHtmlEntities(match[2]);
    if (!meta[key]) meta[key] = [];
    meta[key].push(value);
  }
  return meta;
}

function extractJsonLd(html: string): any[] {
  const out: any[] = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      continue;
    }
  }
  return out;
}


function buildPayloadFromMetadata(target: URL, extracted: ExtractedMetadata): MediaPayload {
  const { meta, jsonld } = extracted;
  const items: MediaItem[] = [];
  const addItem = createMediaItemAdder(items);

  const videoUrls = [...(meta["og:video"] || []), ...(meta["og:video:url"] || []), ...(meta["og:video:secure_url"] || [])];
  const videoType = meta["og:video:type"]?.[0];
  const videoHeight = meta["og:video:height"]?.[0];
  const quality = deriveQuality(videoHeight);
  for (const url of videoUrls) {
    addItem(url, url.endsWith(".m3u8") ? "stream" : "video", quality, videoType);
  }

  const audioUrls = [...(meta["og:audio"] || []), ...(meta["og:audio:url"] || []), ...(meta["og:audio:secure_url"] || [])];
  const audioType = meta["og:audio:type"]?.[0];
  for (const url of audioUrls) {
    addItem(url, "audio", undefined, audioType);
  }

  const imageUrls = [...(meta["og:image"] || []), ...(meta["og:image:url"] || []), ...(meta["twitter:image"] || [])];
  for (const url of imageUrls) {
    addItem(url, "image");
  }

  collectMediaFromJsonLd(jsonld, addItem);

  let thumb = imageUrls.length ? normalizeMediaUrl(imageUrls[0]) : undefined;
  const title = meta["og:title"]?.[0] || meta["twitter:title"]?.[0] || extractJsonLdString(jsonld, ["headline", "name", "title"]);
  const description = meta["og:description"]?.[0] || meta["description"]?.[0] || extractJsonLdString(jsonld, ["description", "caption"]);
  let author = meta["profile:username"]?.[0] || meta["author"]?.[0] || extractJsonLdAuthor(jsonld) || extractHandleFromDescription(meta["og:description"]?.[0]);
  const publishedAt = normalizeDate(meta["article:published_time"]?.[0] || meta["video:release_date"]?.[0] || extractJsonLdDate(jsonld));

  if (!thumb && author && target.hostname.includes("instagram")) {
    thumb = extractInstagramThumbnail(extracted.html);
  }

  const hasVideo = items.some((item) => item.type === "video" || item.type === "stream");
  const hasAudio = items.some((item) => item.type === "audio");
  const hasImage = items.some((item) => item.type === "image");

  if (!items.length && thumb) {
    addItem(thumb, "image");
  }

  let type: MediaPayload["type"];
  if (hasVideo && hasImage) type = "carousel";
  else if (hasVideo) type = hasAudio ? "stream" : "video";
  else if (hasAudio && !hasImage) type = "audio";
  else type = "image";

  return {
    type,
    author,
    title,
    description,
    publishedAt,
    thumb,
    items,
    source: "open-graph",
  };
}

function augmentInstagramPayload(html: string, payload: MediaPayload) {
  const addItem = createMediaItemAdder(payload.items);
  for (const match of html.matchAll(/"video_url":"([^\"]+)"/g)) {
    addItem(decodeJsonUrl(match[1]), "video");
  }
  for (const match of html.matchAll(/"audio_url":"([^\"]+)"/g)) {
    addItem(decodeJsonUrl(match[1]), "audio");
  }
  for (const match of html.matchAll(/"display_url":"([^\"]+)"/g)) {
    addItem(decodeJsonUrl(match[1]), "image");
  }
  for (const match of html.matchAll(/"thumbnail_src":"([^\"]+)"/g)) {
    addItem(decodeJsonUrl(match[1]), "image");
  }
  for (const match of html.matchAll(/"video_versions":\s*(\[[^\]]+\])/g)) {
    try {
      const parsed = JSON.parse(decodeJsonUrl(match[1]));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (entry?.url) {
            const q = entry?.height ? `${entry.height}p` : undefined;
            const mime = entry?.type || entry?.mime_type;
            addItem(entry.url, "video", q, mime);
          }
        }
      }
    } catch {
      continue;
    }
  }
  if (!payload.author) {
    payload.author = extractUsernameFromHtml(html) || payload.author;
  }
  if (!payload.publishedAt) {
    const taken = html.match(/"taken_at":\s*(\d{9,})/);
    if (taken) payload.publishedAt = normalizeDate(Number(taken[1]) * 1000);
  }
  if (!payload.title) {
    const caption = html.match(/"caption":\{"text":"([^\"]+)"/);
    if (caption) payload.title = decodeJsonUrl(caption[1]);
  }
  if (!payload.thumb) {
    payload.thumb = extractInstagramThumbnail(html) || payload.thumb;
  }
}

function extractInstagramThumbnail(html: string): string | undefined {
  const metaMatch = html.match(/property="og:image"\s+content="([^\"]+)"/);
  if (metaMatch) return decodeHtmlEntities(metaMatch[1]);
  const display = html.match(/"display_url":"([^\"]+)"/);
  if (display) return decodeJsonUrl(display[1]);
  return undefined;
}

function isInstagramUnavailablePage(html: string): boolean {
  if (!html) return true;
  const normalized = html.toLowerCase();
  return (
    normalized.includes("instagram") &&
    (normalized.includes("page isn't available") ||
      normalized.includes("page isn&#39;t available") ||
      normalized.includes("log in") ||
      normalized.includes("login") ||
      normalized.includes("sign up"))
  );
}

function collectMediaFromJsonLd(jsonld: any[], addItem: (url: string | undefined, type?: MediaItemType, quality?: string, mime?: string, size?: number) => void) {
  const visit = (node: any) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== "object") return;

    if (typeof node.contentUrl === "string") {
      const type = classifyJsonLdType(node);
      const quality = deriveQuality(node.height || node.width) || node.quality || node.name;
      const mime = node.encodingFormat || node.mimeType || node.contentType;
      const size = parseSize(node.contentSize);
      addItem(node.contentUrl, type, typeof quality === "string" ? quality : undefined, typeof mime === "string" ? mime : undefined, size);
    }
    if (typeof node.url === "string" && node["@type"]) {
      const type = classifyJsonLdType(node);
      const quality = deriveQuality(node.height || node.width) || node.quality || node.name;
      const mime = node.encodingFormat || node.mimeType || node.contentType;
      const size = parseSize(node.contentSize);
      addItem(node.url, type, typeof quality === "string" ? quality : undefined, typeof mime === "string" ? mime : undefined, size);
    }
    visit(node.video);
    visit(node.audio);
    visit(node.image);
    visit(node.associatedMedia);
    visit(node.media);
  };
  visit(jsonld);
}

function classifyJsonLdType(node: any): MediaItemType {
  const typeValue = typeof node?.['@type'] === 'string' ? node['@type'] : '';
  const lower = typeValue.toLowerCase();
  if (lower.includes('audio')) return 'audio';
  if (lower.includes('image')) return 'image';
  if (lower.includes('playlist') || lower.includes('stream')) return 'stream';
  return lower.includes('video') ? 'video' : inferMediaType(typeof node?.contentUrl === 'string' ? node.contentUrl : node?.url, 'video');
}

function parseSize(value: any): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const numeric = Number(value.replace(/[^0-9.]/g, ''));
    if (!Number.isNaN(numeric) && numeric > 0) return numeric;
  }
  return undefined;
}

function deriveQuality(heightValue: any): string | undefined {
  const heightNumber = typeof heightValue === 'number' ? heightValue : typeof heightValue === 'string' ? Number(heightValue) : undefined;
  if (heightNumber && !Number.isNaN(heightNumber) && heightNumber > 0) {
    return `${Math.round(heightNumber)}p`;
  }
  return undefined;
}

function createMediaItemAdder(collection: MediaItem[]): (url: string | undefined, type?: MediaItemType, quality?: string, mime?: string, size?: number) => void {
  const seen = new Set(collection.map((item) => item.url));
  return (rawUrl, type, quality, mime, size) => {
    if (!rawUrl) return;
    const url = normalizeMediaUrl(rawUrl);
    if (!url || !/^https?:/i.test(url) || seen.has(url)) return;
    const resolvedType = type ?? inferMediaType(url, 'video');
    collection.push({ type: resolvedType, quality, mime, size, url });
    seen.add(url);
  };
}

function dedupeMediaItems(items: MediaItem[]): MediaItem[] {
  const seen = new Set<string>();
  const out: MediaItem[] = [];
  for (const item of items) {
    const key = `${item.type}:${item.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

async function enrichMediaItems(items: MediaItem[]): Promise<void> {
  const limited = items.filter((item) => /^https?:/i.test(item.url)).slice(0, 4);
  await Promise.all(limited.map(async (item) => {
    if (item.type === 'image' && item.size && item.mime) return;
    try {
      const res = await fetch(item.url, { method: 'HEAD' });
      if (!res.ok) return;
      if (!item.mime) {
        const type = res.headers.get('content-type');
        if (type) item.mime = type.split(';')[0];
      }
      if (!item.size) {
        const len = res.headers.get('content-length');
        if (len) {
          const size = Number(len);
          if (!Number.isNaN(size)) item.size = size;
        }
      }
    } catch {
      // swallow
    }
  }));
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (full, entity) => {
    const lower = entity.toLowerCase();
    if (lower === 'amp') return '&';
    if (lower === 'lt') return '<';
    if (lower === 'gt') return '>';
    if (lower === 'quot') return '"';
    if (lower === '#039') return "'";
    if (lower.startsWith('#x')) {
      const codePoint = parseInt(lower.slice(2), 16);
      if (!Number.isNaN(codePoint)) return String.fromCodePoint(codePoint);
    }
    if (lower.startsWith('#')) {
      const codePoint = parseInt(lower.slice(1), 10);
      if (!Number.isNaN(codePoint)) return String.fromCodePoint(codePoint);
    }
    return full;
  });
}

function decodeJsonUrl(value: string): string {
  return normalizeMediaUrl(value.replace(/\\\//g, '/').replace(/\\u0026/g, '&'));
}

function normalizeMediaUrl(raw: string): string {
  return decodeHtmlEntities(raw.trim());
}

function inferMediaType(url: string | undefined, fallback: MediaItemType): MediaItemType {
  if (!url) return fallback;
  const lower = url.toLowerCase();
  if (/(\.mp3|\.wav|\.aac|\.m4a)(\?|$)/.test(lower)) return 'audio';
  if (/(\.mp4|\.mov|\.m4v|\.webm|\.mkv)(\?|$)/.test(lower)) return 'video';
  if (/(\.jpg|\.jpeg|\.png|\.gif|\.webp)(\?|$)/.test(lower)) return 'image';
  if (lower.endsWith('.m3u8') || lower.includes('m3u8')) return 'stream';
  return fallback;
}

function normalizeDate(input: any): string | undefined {
  if (input == null) return undefined;
  if (typeof input === 'number') {
    const value = input < 1e12 ? input * 1000 : input;
    return new Date(value).toISOString().slice(0, 10);
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric)) return normalizeDate(numeric);
    const parsed = Date.parse(trimmed);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  }
  return undefined;
}

function extractJsonLdAuthor(jsonld: any[]): string | undefined {
  let result: string | undefined;
  const visit = (node: any) => {
    if (!node || result) return;
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (typeof node !== 'object') return;
    const author = node.author || node.creator;
    if (author) {
      if (typeof author === 'string') result = author;
      else if (Array.isArray(author)) {
        for (const entry of author) {
          if (typeof entry === 'string') { result = entry; break; }
          if (entry?.name) { result = entry.name; break; }
        }
      } else if (typeof author === 'object' && author.name) {
        result = author.name;
      }
    }
    if (!result) {
      visit(node.video);
      visit(node.audio);
      visit(node.image);
      visit(node.associatedMedia);
    }
  };
  visit(jsonld);
  if (typeof result === 'string') {
    const handle = extractHandleFromDescription(result);
    return handle || result;
  }
  return undefined;
}

function extractJsonLdString(jsonld: any[], keys: string[]): string | undefined {
  for (const node of jsonld) {
    const value = findStringInObject(node, keys);
    if (value) return value;
  }
  return undefined;
}

function extractJsonLdDate(jsonld: any[]): string | undefined {
  const value = extractJsonLdString(jsonld, ['uploadDate', 'datePublished', 'publishDate', 'dateCreated']);
  return normalizeDate(value);
}

function findStringInObject(node: any, keys: string[]): string | undefined {
  if (!node) return undefined;
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const result = findStringInObject(entry, keys);
      if (result) return result;
    }
    return undefined;
  }
  if (typeof node === 'object') {
    for (const key of keys) {
      const value = (node as any)[key];
      if (value) {
        const result = findStringInObject(value, keys);
        if (result) return result;
      }
    }
    for (const value of Object.values(node)) {
      const result = findStringInObject(value, keys);
      if (result) return result;
    }
  }
  return undefined;
}

function extractHandleFromDescription(description?: string): string | undefined {
  if (!description) return undefined;
  const handle = description.match(/@([a-z0-9_.]+)/i);
  if (handle) return handle[1];
  const prefix = description.match(/^([a-z0-9_.-]{3,})[:\s]/i);
  if (prefix) return prefix[1];
  return undefined;
}

function extractUsernameFromHtml(html: string): string | undefined {
  const match = html.match(/"username":"([^\"]+)"/);
  if (match) return decodeJsonUrl(match[1]);
  const alternative = html.match(/"owner":\{[^}]*"username":"([^\"]+)"/);
  if (alternative) return decodeJsonUrl(alternative[1]);
  return undefined;
}

function extractYouTubeId(target: URL): string | null {
  if (target.hostname.endsWith('youtu.be')) {
    return target.pathname.replace(/^\//, '').split('/')[0] || null;
  }
  if (target.searchParams.get('v')) {
    return target.searchParams.get('v');
  }
  const path = target.pathname;
  const shorts = path.match(/\/shorts\/([^/?]+)/);
  if (shorts) return shorts[1];
  const embed = path.match(/\/embed\/([^/?]+)/);
  if (embed) return embed[1];
  const live = path.match(/\/live\/([^/?]+)/);
  if (live) return live[1];
  return null;
}
