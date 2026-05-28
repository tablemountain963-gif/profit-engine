// Targeted cleanup: remove junk-topic / duplicate / corrupt content while KEEPING
// good Groq-era content and both live products. Blacklists junk so the engine
// won't regenerate it. Run: node scripts/purge-junk.js
import { paths, readJson, writeJson, readText, writeText, logger, slugify } from '../src/lib/util.js';
import { looksCorrupt } from '../src/ai/providers.js';
import { join } from 'node:path';
import { existsSync, rmSync, readdirSync } from 'node:fs';

// Live products with covers + Gumroad listings — never drop.
const KEEP_PRODUCTS = new Set([
  'prompt-pack-boost-sales-2026-05-28',
  'prompt-pack-gemini-2026-05-28',
]);

// Junk topic keywords (matched as substring of slug). Person/news/place names,
// near-duplicates, weak bare nouns. Also seeded into the dedup blacklist.
const JUNK_TOPICS = [
  'tomas-sanchez', 'john-milton', 'arthur-rackham', 'rude-don', 'white-house',
  'trading-bot', 'bot-polymarket',         // near-dups of polymarket-trading
  'google',                                // bare brand noun, thin
  'temu', 'anthropic', 'job-cuts', 'explanation-problem',  // weak/grim product topics
  'bay-area', 'swiss', 'teenagers', 'instagram', 'youtube', 'youtubers', 'salesforce',
  'threads', 'threadsky', 'amawebb', 'digital-services-act', 'regenerative-adult', 'stem-cells',
  'shadowspread', 'distant-corporate', 'corporate-overlord',
];

function rm(p) { try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch {} }
function isJunkSlug(slug) { return JUNK_TOPICS.some(j => slug.includes(j)); }

// ── Articles: drop junk slugs + corrupt; keep the rest ──
const artDir = join(paths.output, 'articles');
const am = readJson(join(paths.data, 'articles.json'), { items: [] });
const keptArticles = [];
for (const a of am.items || []) {
  const file = join(paths.output, a.file);
  const corrupt = existsSync(file) ? looksCorrupt(readText(file)) : true;
  if (isJunkSlug(a.slug) || corrupt) {
    rm(file);
    logger.warn(`purged article: ${a.slug}`);
  } else {
    keptArticles.push(a);
  }
}
am.items = keptArticles;
writeJson(join(paths.data, 'articles.json'), am);
logger.ok(`articles kept: ${keptArticles.length}`);

// Patch legacy /products/ (404 dir) -> /products.html in surviving article files.
let patched = 0;
for (const a of keptArticles) {
  const file = join(paths.output, a.file);
  if (!existsSync(file)) continue;
  const md = readText(file);
  if (md.includes('](/products/)')) {
    writeText(file, md.replaceAll('](/products/)', '](/products.html)'));
    patched++;
  }
}
if (patched) logger.ok(`patched /products/ link in ${patched} articles`);

// ── Products: keep whitelist + non-junk non-corrupt; drop rest ──
const prodDir = join(paths.output, 'products');
const salesDir = join(paths.output, 'sales');
const keptProductSlugs = [];
if (existsSync(prodDir)) {
  for (const slug of readdirSync(prodDir)) {
    if (KEEP_PRODUCTS.has(slug)) { keptProductSlugs.push(slug); continue; }
    const main = ['prompts.md', 'playbook.md', 'checklist.md', 'ebook.md']
      .map(f => join(prodDir, slug, f)).find(existsSync);
    const corrupt = !main || looksCorrupt(readText(main));
    if (isJunkSlug(slug) || corrupt) {
      rm(join(prodDir, slug));
      rm(join(salesDir, `${slug}.md`));
      logger.warn(`purged product: ${slug}`);
    } else {
      keptProductSlugs.push(slug);
    }
  }
}
const pm = readJson(join(paths.data, 'products.json'), { items: [] });
pm.items = (pm.items || []).filter(p => keptProductSlugs.includes(p.slug));
writeJson(join(paths.data, 'products.json'), pm);
logger.ok(`products kept: ${keptProductSlugs.join(', ') || 'none'}`);

// ── Social: wipe (low-value news drafts, repopulate clean) ──
const socDir = join(paths.output, 'social');
if (existsSync(socDir)) for (const f of readdirSync(socDir)) rm(join(socDir, f));
writeJson(join(paths.data, 'social.json'), { items: [] });
logger.ok('social wiped (will repopulate clean)');

// ── Blacklist junk topics so the engine won't regenerate them ──
const mem = readJson(join(paths.data, 'memory.json'), { topics: {}, niches: {}, blacklist: [] });
mem.blacklist = [...new Set([...(mem.blacklist || []), ...JUNK_TOPICS.map(j => slugify(j.replace(/-/g, ' ')))])];
// drop junk topics from dedup history too
for (const k of Object.keys(mem.topics || {})) {
  if (JUNK_TOPICS.some(j => k.includes(j) || j.includes(k))) delete mem.topics[k];
}
writeJson(join(paths.data, 'memory.json'), mem);
logger.ok(`blacklist now ${mem.blacklist.length} terms`);

logger.ok('purge complete');
