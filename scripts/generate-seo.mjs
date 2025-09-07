import { mkdir, writeFile, readdir, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';

// Generate robots.txt and sitemap.xml at build time
const outDir = resolve(process.cwd(), 'public');
await mkdir(outDir, { recursive: true });

// The definitive URL for your site. No trailing slash.
const siteUrl = 'https://www.uptools.in';
const sitemapLoc = `${siteUrl}/sitemap.xml`;
// Discover all directories containing an index.html and add them to the sitemap automatically.
const ROOT = process.cwd();
const IGNORE = new Set([
  '.git', 'node_modules', 'dist', 'public', '.vscode', '.wrangler', 'assets', 'scripts', 'worker'
]);

async function walk(dir, out) {
  const items = await readdir(dir, { withFileTypes: true });
  const names = new Set(items.map(d => d.name));
  // If this directory has index.html, include it
  if (names.has('index.html')) {
    const rel = relative(ROOT, dir).split(sep).join('/');
    const path = rel === '' ? '/' : `/${rel}/`;
    out.add(path);
  }
  for (const it of items) {
    if (!it.isDirectory()) continue;
    if (IGNORE.has(it.name) || it.name.startsWith('.')) continue;
    await walk(resolve(dir, it.name), out);
  }
}

const pathSet = new Set();
await walk(ROOT, pathSet);
// Ensure homepage present
pathSet.add('/');
// Convert to sorted list; prioritize shorter paths first for readability
const paths = Array.from(pathSet).sort((a,b)=>a.localeCompare(b));

// Default attributes for sitemap entries
const defaultPriority = 0.6;
const defaultChangefreq = 'yearly';
const lastmod = new Date().toISOString().split('T')[0];

const entries = paths.map(path => {
  const url = `${siteUrl}${path}`;
  // You can customize priority and changefreq per-URL if needed here
  let priority = defaultPriority;
  let changefreq = defaultChangefreq;
  if (path === '/') {
    priority = 0.7;
    changefreq = 'monthly';
  } else if (path.includes('tax') || path.includes('emi') || path.includes('sip') || path.includes('gst')) {
    priority = 0.7;
    changefreq = 'monthly';
  } else if (path.includes('currency') || path.includes('crypto-prices')) {
    priority = 0.8;
    changefreq = 'daily';
  } else if (path.includes('crypto-portfolio') || path.includes('crypto-profitability')) {
    priority = 0.8;
    changefreq = 'weekly';
  } else if (path.includes('games/')) {
    priority = 0.6;
    changefreq = 'monthly';
  } else if (path === '/games/') {
    priority = 0.7;
    changefreq = 'weekly';
  }

  return `  <url>
    <loc>${url}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}).join('\n');

const robots = `User-agent: *
Allow: /
Sitemap: ${sitemapLoc}
`;
await writeFile(resolve(outDir, 'robots.txt'), robots, 'utf8');

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
await writeFile(resolve(outDir, 'sitemap.xml'), sitemap, 'utf8');

