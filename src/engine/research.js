// Scrape-research module. Fetches actual content from top trending items,
// extracts factual material, builds article research notes used by content generators.
// Operates within fair-use paraphrase + attribution.
import { fetchText, logger } from '../lib/util.js';

// Extract a clean text excerpt from a URL.
// Strips HTML, scripts, styles, navigation, footers. Best-effort, no deps.
export async function extractExcerpt(url, maxChars = 1500) {
  if (!url || !/^https?:/i.test(url)) return null;
  if (isBlocked(url)) return null;

  try {
    const html = await fetchText(url, { timeout: 10000 });
    const text = stripToText(html);
    return text.slice(0, maxChars);
  } catch (e) {
    logger.dbg(`extract fail ${url}: ${e.message}`);
    return null;
  }
}

const BLOCKED_DOMAINS = [
  // Avoid scraping behind walls / heavy JS / login-required pages.
  'twitter.com', 'x.com', 'instagram.com', 'facebook.com', 'linkedin.com',
  'medium.com', // requires JS to view full article
  'reddit.com', // already get title/selftext from JSON API
];

function isBlocked(url) {
  try {
    const u = new URL(url);
    return BLOCKED_DOMAINS.some(d => u.host.endsWith(d));
  } catch {
    return true;
  }
}

function stripToText(html) {
  // Remove scripts, styles, comments, nav, footer, aside
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');
  s = s.replace(/<(nav|footer|aside|header|form|svg)[^>]*>[\s\S]*?<\/\1>/gi, ' ');

  // Prefer article/main content if present
  const main = s.match(/<(article|main)[^>]*>([\s\S]*?)<\/\1>/i);
  if (main) s = main[2];

  // Strip remaining tags
  s = s.replace(/<[^>]+>/g, ' ');

  // Decode common entities
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
       .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

  // Collapse whitespace
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

// Build "research notes" — a compact bundle of facts from sources backing a topic.
// Used by the content generator as grounding material.
export async function gatherResearch(opportunity, limit = 3) {
  const examples = (opportunity.examples || []).slice(0, limit);
  const notes = [];

  for (const ex of examples) {
    if (!ex.url) continue;
    const excerpt = await extractExcerpt(ex.url, 800);
    notes.push({
      title: ex.title,
      url: ex.url,
      source: ex.source,
      excerpt: excerpt || null,
    });
  }

  return notes;
}

// Render research notes as a "Sources & Context" markdown block.
// Attribution + link-out, builds outbound link graph (good for SEO trust + reader value).
export function renderSourcesBlock(notes) {
  const valid = notes.filter(n => n && n.url);
  if (valid.length === 0) return '';

  const items = valid.map(n => {
    const cite = n.excerpt
      ? `\n   > ${truncate(n.excerpt, 220)}`
      : '';
    return `- [**${escapeMd(n.title)}**](${n.url}) — ${labelFor(n.source)}${cite}`;
  }).join('\n');

  return `\n\n## Sources & Context\n\nReporting and discussion this guide draws on:\n\n${items}\n\n*All sources are linked. Excerpts are quoted under fair use to give you context before clicking through.*\n`;
}

// Render notes as compact "Key Points" derived from titles + excerpts.
// Pure extraction — no rewriting, no hallucination. Deduped.
export function renderKeyPointsBlock(notes, topic) {
  const seen = new Set();
  const points = notes
    .map(n => extractKeyPoint(n))
    .filter(p => {
      if (!p) return false;
      const norm = p.toLowerCase().replace(/[^a-z0-9 ]/g, '').slice(0, 80);
      if (seen.has(norm)) return false;
      seen.add(norm);
      return true;
    });

  if (points.length === 0) return '';

  return `\n\n## What People Are Saying About ${topic}\n\n${points.map(p => `- ${p}`).join('\n')}\n`;
}

function extractKeyPoint(note) {
  if (!note) return null;
  const text = note.excerpt || note.title || '';
  // Take first sentence-ish
  const sentence = text.split(/\.\s/)[0];
  return sentence ? truncate(sentence, 180) + (sentence.endsWith('.') ? '' : '.') : null;
}

function escapeMd(s) {
  return String(s).replace(/([\\`*_\[\]])/g, '\\$1');
}

function truncate(s, n) {
  s = String(s).trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
}

function labelFor(source) {
  return ({
    hackernews: 'Hacker News',
    reddit: 'Reddit',
    github: 'GitHub',
    lobsters: 'Lobsters',
    devto: 'DEV.to',
    producthunt: 'Product Hunt',
    mastodon: 'Mastodon',
    npm: 'npm',
    pypi: 'PyPI',
  }[source] || (source || 'source'));
}
