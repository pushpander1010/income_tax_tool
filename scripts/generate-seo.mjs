import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Generate robots.txt and sitemap.xml at build time
const outDir = resolve(process.cwd(), 'public');
await mkdir(outDir, { recursive: true });

// The definitive URL for your site. No trailing slash.
const siteUrl = 'https://www.uptools.in';
const sitemapLoc = `${siteUrl}/sitemap.xml`;
const paths = [
  '/',
  '/income-tax-tool/',
  '/bmi-calculator/',
  '/emi-calculator/',
  '/fd-calculator/',
  '/sip-calculator/',
  '/age-calculator/',
  '/image-tool/',
  '/image-converter/',
  '/unit-converter/',
  '/password-generator/',
  '/qr-generator/',
  '/text-case-converter/',
  '/word-counter/',
  '/json-formatter/',
  '/base64-encoder/',
  '/ip-address/',
  '/uuid-generator/',
  '/gst-calculator/',
  '/currency-converter/',
  '/canada-hst-tool/',
  '/canada-crs-tool/',
  '/pan-validator/',
  '/ifsc-finder/',
  '/color-picker/',
  '/wifi-router/',
  '/qr-reader/',
  '/whatsapp-chat/',
  '/whatsapp-stickers/',
  '/exif-tool/',
  '/ai-writer/',
  '/ai-plagiarism/',
  '/resume-analyzer/',
  '/crypto-unit-converter/',
  '/about/',
  '/contact/',
  '/privacy-policy/',
  '/games/',
  '/games/tic-tac-toe/',
  '/games/memory-match/',
  '/games/snake/',
  '/games/number-guessing/',
  '/games/color-rush/',
  '/games/sudoku/',
  '/games/love-test/',
];

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
  } else if (path.includes('currency')) {
    priority = 0.8;
    changefreq = 'daily';
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

