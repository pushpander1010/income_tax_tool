import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Generate robots.txt and sitemap.xml at build time
const outDir = resolve(process.cwd(), 'public');
await mkdir(outDir, { recursive: true });

const siteUrl = process.env.SITE_URL?.replace(/\/$/, '') || '';
const sitemapLoc = siteUrl ? `${siteUrl}/sitemap.xml` : `/sitemap.xml`;
const homeLoc = siteUrl ? `${siteUrl}/` : `/`;
const pages = [
  { loc: homeLoc, priority: 0.7, changefreq: 'monthly' },
  { loc: siteUrl ? `${siteUrl}/income-tax-calculator/` : `/income-tax-calculator/`, priority: 0.8, changefreq: 'monthly' },
  { loc: siteUrl ? `${siteUrl}/bmi-calculator/` : `/bmi-calculator/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/emi-calculator/` : `/emi-calculator/`, priority: 0.7, changefreq: 'monthly' },
  { loc: siteUrl ? `${siteUrl}/fd-calculator/` : `/fd-calculator/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/sip-calculator/` : `/sip-calculator/`, priority: 0.7, changefreq: 'monthly' },
  { loc: siteUrl ? `${siteUrl}/age-calculator/` : `/age-calculator/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/unit-converter/` : `/unit-converter/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/password-generator/` : `/password-generator/`, priority: 0.5, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/qr-generator/` : `/qr-generator/`, priority: 0.5, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/text-case-converter/` : `/text-case-converter/`, priority: 0.5, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/word-counter/` : `/word-counter/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/json-formatter/` : `/json-formatter/`, priority: 0.6, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/base64-encoder/` : `/base64-encoder/`, priority: 0.5, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/ip-address/` : `/ip-address/`, priority: 0.5, changefreq: 'yearly' },
  { loc: siteUrl ? `${siteUrl}/uuid-generator/` : `/uuid-generator/`, priority: 0.5, changefreq: 'yearly' }
  ,{ loc: siteUrl ? `${siteUrl}/gst-calculator/` : `/gst-calculator/`, priority: 0.7, changefreq: 'monthly' }
  ,{ loc: siteUrl ? `${siteUrl}/currency-converter/` : `/currency-converter/`, priority: 0.8, changefreq: 'daily' }
  ,{ loc: siteUrl ? `${siteUrl}/date-difference/` : `/date-difference/`, priority: 0.6, changefreq: 'yearly' }
  ,{ loc: siteUrl ? `${siteUrl}/pan-validator/` : `/pan-validator/`, priority: 0.6, changefreq: 'yearly' }
  ,{ loc: siteUrl ? `${siteUrl}/ifsc-finder/` : `/ifsc-finder/`, priority: 0.6, changefreq: 'yearly' }
  ,{ loc: siteUrl ? `${siteUrl}/color-picker/` : `/color-picker/`, priority: 0.5, changefreq: 'yearly' }
];
const lastmod = new Date().toISOString().split('T')[0];

const robots = `User-agent: *\nAllow: /\nSitemap: ${sitemapLoc}\n`;
await writeFile(resolve(outDir, 'robots.txt'), robots, 'utf8');

const entries = pages.map(p => `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`).join('\n');
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
await writeFile(resolve(outDir, 'sitemap.xml'), sitemap, 'utf8');

console.log(`[seo] robots.txt and sitemap.xml generated at ${outDir}`);


