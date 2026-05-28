// SEO module. JSON-LD schema.org, meta description extraction, canonical URLs, IndexNow.
import { logger, fetchJson } from '../lib/util.js';
import { createHash, randomUUID } from 'node:crypto';

// Base URL — overridable via env for custom domains.
export function siteBaseUrl() {
  if (process.env.SITE_BASE_URL) return process.env.SITE_BASE_URL.replace(/\/$/, '');
  // Default to GitHub Pages convention.
  const repo = process.env.GITHUB_REPOSITORY;  // user/repo
  if (repo) {
    const [user, name] = repo.split('/');
    return `https://${user}.github.io/${name}`;
  }
  return 'https://tablemountain963-gif.github.io/profit-engine';
}

// Extract meta description from markdown body (first meaningful sentence).
export function metaDescription(markdown, fallback = '') {
  const stripped = markdown
    .replace(/^---[\s\S]*?---\n/, '')
    .replace(/^#.*$/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const firstPara = stripped.split(/\.\s/)[0];
  const desc = (firstPara || fallback).slice(0, 156).trim();
  return desc + (desc.length === 156 ? '…' : '.');
}

// Build schema.org JSON-LD blob for an article.
export function articleSchema({ title, description, url, datePublished, author, image }) {
  const base = siteBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    datePublished,
    dateModified: datePublished,
    author: { '@type': 'Organization', name: author || 'Profit Engine' },
    publisher: {
      '@type': 'Organization',
      name: 'Profit Engine',
      url: base,
    },
    ...(image ? { image } : {}),
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
  };
}

export function productSchema({ title, description, price, slug, image }) {
  const base = siteBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: title,
    description,
    image: image || `${base}/og-default.png`,
    offers: {
      '@type': 'Offer',
      price: String(price),
      priceCurrency: 'USD',
      availability: 'https://schema.org/InStock',
      url: `${base}/products/${slug}.html`,
    },
  };
}

export function breadcrumbSchema(crumbs) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };
}

export function websiteSchema() {
  const base = siteBaseUrl();
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Profit Engine',
    url: base,
    description: 'Autonomous trend signals, affiliate guides, digital starter packs.',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${base}/?q={search_term_string}`,
      'query-input': 'required name=search_term_string',
    },
  };
}

// IndexNow — Bing/Yandex auto-indexing protocol. No auth, no account.
// We generate and host a key file, then ping with new URLs.
const INDEXNOW_KEY = process.env.INDEXNOW_KEY || deterministicKey();

function deterministicKey() {
  // Generate a stable key derived from repo (so the key file matches the ping).
  const repo = process.env.GITHUB_REPOSITORY || 'profit-engine';
  return createHash('sha256').update(`profit-engine-${repo}`).digest('hex').slice(0, 32);
}

export function indexNowKey() {
  return INDEXNOW_KEY;
}

export function indexNowKeyFile() {
  return { name: `${INDEXNOW_KEY}.txt`, body: INDEXNOW_KEY };
}

export async function pingIndexNow(urls) {
  const base = siteBaseUrl();
  const host = new URL(base).host;
  if (!Array.isArray(urls) || urls.length === 0) return { skipped: true };

  const payload = {
    host,
    key: INDEXNOW_KEY,
    keyLocation: `${base}/${INDEXNOW_KEY}.txt`,
    urlList: urls.slice(0, 10000),
  };

  try {
    const r = await fetch('https://api.indexnow.org/IndexNow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    logger.info(`indexnow: ${r.status} for ${urls.length} urls`);
    return { ok: r.ok, status: r.status };
  } catch (e) {
    logger.warn(`indexnow fail: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// Ping Google sitemap endpoint. No-op in 2024+ (deprecated) but harmless.
export async function pingGoogleSitemap() {
  const base = siteBaseUrl();
  try {
    const url = `https://www.google.com/ping?sitemap=${encodeURIComponent(`${base}/sitemap.xml`)}`;
    const r = await fetch(url);
    logger.info(`google sitemap ping: ${r.status}`);
    return { ok: r.ok };
  } catch (e) {
    return { ok: false };
  }
}

// Generate a full <head> meta block as an HTML string for embedding.
export function metaBlock({ title, description, url, image, type = 'article', schema }) {
  const base = siteBaseUrl();
  const absImage = image ? (image.startsWith('http') ? image : `${base}${image}`) : `${base}/og-default.svg`;
  const t = String(title).replace(/"/g, '&quot;');
  const d = String(description).replace(/"/g, '&quot;');
  const u = url;
  const schemaJson = schema ? JSON.stringify(schema) : '';
  return `
<meta name="description" content="${d}" />
<link rel="canonical" href="${u}" />
<meta property="og:title" content="${t}" />
<meta property="og:description" content="${d}" />
<meta property="og:type" content="${type}" />
<meta property="og:url" content="${u}" />
<meta property="og:image" content="${absImage}" />
<meta property="og:site_name" content="Profit Engine" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${t}" />
<meta name="twitter:description" content="${d}" />
<meta name="twitter:image" content="${absImage}" />
${schemaJson ? `<script type="application/ld+json">${schemaJson}</script>` : ''}
`;
}
