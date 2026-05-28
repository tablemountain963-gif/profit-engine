// One-off cleanup: remove corrupt/low-quality generated content so only
// quality-gated, Groq-era content remains. Keeps an explicit whitelist.
// Articles/social are wiped (pre-fix junk topics) and will repopulate cleanly.
import { paths, readJson, writeJson, readText, logger } from '../src/lib/util.js';
import { looksCorrupt } from '../src/ai/providers.js';
import { join } from 'node:path';
import { existsSync, rmSync, readdirSync, unlinkSync } from 'node:fs';

const KEEP_PRODUCTS = new Set(['prompt-pack-boost-sales-2026-05-28']);

function rm(p) { try { if (existsSync(p)) rmSync(p, { recursive: true, force: true }); } catch {} }

// ── Products: keep whitelist + any non-corrupt; drop the rest ──
const prodDir = join(paths.output, 'products');
const salesDir = join(paths.output, 'sales');
const keptProducts = [];
if (existsSync(prodDir)) {
  for (const slug of readdirSync(prodDir)) {
    if (KEEP_PRODUCTS.has(slug)) { keptProducts.push(slug); continue; }
    const main = ['prompts.md', 'playbook.md', 'checklist.md', 'ebook.md']
      .map(f => join(prodDir, slug, f)).find(existsSync);
    const corrupt = !main || looksCorrupt(readText(main));
    if (corrupt) {
      rm(join(prodDir, slug));
      rm(join(salesDir, `${slug}.md`));
      logger.warn(`purged product: ${slug}`);
    } else {
      keptProducts.push(slug);
    }
  }
}
// Rebuild products manifest from survivors
const pm = readJson(join(paths.data, 'products.json'), { items: [] });
pm.items = (pm.items || []).filter(p => keptProducts.includes(p.slug));
writeJson(join(paths.data, 'products.json'), pm);
logger.ok(`products kept: ${keptProducts.join(', ') || 'none'}`);

// ── Articles: wipe all (pre-fix junk topics). Fresh runs repopulate. ──
const artDir = join(paths.output, 'articles');
if (existsSync(artDir)) for (const f of readdirSync(artDir)) rm(join(artDir, f));
writeJson(join(paths.data, 'articles.json'), { items: [] });
logger.ok('articles wiped (will repopulate clean)');

// ── Social: wipe all (pre-fix junk topics). ──
const socDir = join(paths.output, 'social');
if (existsSync(socDir)) for (const f of readdirSync(socDir)) rm(join(socDir, f));
writeJson(join(paths.data, 'social.json'), { items: [] });
logger.ok('social wiped (will repopulate clean)');

// ── Memory: reset topic dedup so fresh good topics aren't blocked ──
writeJson(join(paths.data, 'memory.json'), { topics: {}, niches: {}, blacklist: [] });
writeJson(join(paths.data, 'feedback-pending.json'), { pending: [] });
logger.ok('memory + feedback reset');

logger.ok('purge complete');
