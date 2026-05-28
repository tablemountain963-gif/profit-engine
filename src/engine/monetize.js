// Monetization hooks. Affiliate link builders, ad placements, lead magnets, CTAs.
import { readJson, writeJson, paths, slugify } from '../lib/util.js';
import { join } from 'node:path';

// Affiliate tag config. User can add their tags later via env or data/affiliates.json.
function loadAffiliateConfig() {
  const file = join(paths.data, 'affiliates.json');
  const cfg = readJson(file, null);
  if (cfg) return cfg;

  // Defaults: generic placeholders. User replaces with their actual affiliate tags.
  const defaults = {
    amazon: {
      tag: process.env.AMAZON_ASSOC_TAG || '',  // e.g. mytag-20
      enabled: !!process.env.AMAZON_ASSOC_TAG,
      buildLink: (productSearchQuery) => {
        const q = encodeURIComponent(productSearchQuery);
        const tag = process.env.AMAZON_ASSOC_TAG;
        return tag ? `https://www.amazon.com/s?k=${q}&tag=${tag}` : `https://www.amazon.com/s?k=${q}`;
      },
    },
    impact: { tag: process.env.IMPACT_PUB_ID || '', enabled: false },
    shareasale: { tag: process.env.SHAREASALE_AFF_ID || '', enabled: false },
    cj: { tag: process.env.CJ_PID || '', enabled: false },
    // Sponsorship slot — user can sell directly without account.
    direct: {
      enabled: true,
      url: process.env.SPONSOR_URL || 'mailto:sponsor@example.com?subject=Sponsorship%20Inquiry',
    },
  };
  writeJson(file, defaults);
  return defaults;
}

// Builds an affiliate-enriched link given a generic product query.
// Adds UTM params so affiliate dashboards attribute by article.
export function affiliateLink(productQuery, network = 'amazon', utmContent = '') {
  const cfg = loadAffiliateConfig();
  let url;
  if (cfg.amazon?.enabled && network === 'amazon') {
    url = cfg.amazon.buildLink(productQuery);
  } else if (network === 'amazon') {
    url = `https://www.amazon.com/s?k=${encodeURIComponent(productQuery)}`;
  } else {
    url = `https://duckduckgo.com/?q=${encodeURIComponent(productQuery + ' best price')}`;
  }
  return appendUtm(url, { source: 'profit-engine', medium: 'article', content: utmContent });
}

function appendUtm(url, { source, medium, content }) {
  try {
    const u = new URL(url);
    if (source) u.searchParams.set('utm_source', source);
    if (medium) u.searchParams.set('utm_medium', medium);
    if (content) u.searchParams.set('utm_content', content);
    return u.toString();
  } catch {
    return url;
  }
}

// Inserts CTA blocks into rendered markdown so every article has revenue paths.
export function injectMonetization(markdown, topic, opts = {}) {
  const productQueries = opts.products || extractProductCandidates(markdown, topic);
  const cfg = loadAffiliateConfig();
  const articleSlug = opts.slug || slugify(topic);

  let out = markdown;

  // 1. Recommended Tools section (affiliate links with UTM attribution)
  if (productQueries.length > 0) {
    const links = productQueries.slice(0, 6).map((q, i) =>
      `${i + 1}. **${q}** — [Compare prices](${affiliateLink(q, 'amazon', articleSlug)})`
    ).join('\n');
    const cta = `\n\n## Recommended Tools\n\nSome picks below for ${topic}. Links use affiliate codes when available — your purchase price stays the same.\n\n${links}\n`;
    out += cta;
  }

  // 2. Newsletter capture (lead magnet → recurring sponsor revenue)
  out += `\n\n## Get Weekly Picks Like This\n\n[Subscribe to the free newsletter](/subscribe.html) — one curated email per week on ${topic} and related niches.\n`;

  // 3. Digital product cross-sell
  out += `\n## Want the Deep-Dive Pack?\n\nThe **${capitalize(topic)} Starter Pack** condenses everything in this guide plus printable checklists, templates, and a 30-day plan. [See pack →](/products.html)\n`;

  // 4. Sponsorship slot
  if (cfg.direct?.enabled) {
    out += `\n---\n*Sponsored by your brand? [Get in front of this audience.](${cfg.direct.url})*\n`;
  }

  return out;
}

function extractProductCandidates(text, topic) {
  // Mine markdown text for product-shaped phrases.
  // Combine with topic-derived generic queries.
  const candidates = new Set();

  // Detect "best X for Y" patterns
  const bestRe = /best ([\w\s-]{3,40}) (?:for|in|under)/gi;
  let m;
  while ((m = bestRe.exec(text))) candidates.add(m[1].trim());

  // Detect quoted product mentions
  const qRe = /"([\w\s-]{3,40})"/g;
  while ((m = qRe.exec(text))) {
    const v = m[1].trim();
    if (/[A-Za-z]/.test(v) && v.split(' ').length <= 5) candidates.add(v);
  }

  // Topic-driven generic queries
  candidates.add(`${topic} starter kit`);
  candidates.add(`${topic} best`);
  candidates.add(`${topic} tool`);

  return [...candidates].slice(0, 8);
}

function capitalize(s) {
  return String(s).split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Display ad placeholder (Carbon / EthicalAds zone — user pastes embed once)
export function adPlaceholder() {
  return `\n<!-- AD_ZONE -->\n<div class="ad-zone" data-zone="article">\n  <!-- Replace with Carbon Ads, EthicalAds, or AdSense embed -->\n</div>\n`;
}
