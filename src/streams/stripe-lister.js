// Stripe auto-lister stream. For each generated product not yet listed, ensures a
// buyer bundle exists, creates a Stripe Payment Link, and records it in
// data/buy-links.json so build-site wires a live "Buy now" button. No-op without key.
import { logger, paths, readJson, writeJson } from '../lib/util.js';
import { hasStripeCreds, createPaymentLink, updateProduct } from '../engine/publishers/stripe.js';
import { makeBundle } from '../../scripts/make-bundle.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const DEFAULT_COVER = '/assets/pack-cover.png';

// Rich checkout description from product meta — what's inside, format, terms.
function richDescription(p) {
  const inside = ({
    'prompt-pack': '50 copy-paste prompts',
    'checklist': 'a printable operator checklist',
    'starter-kit': 'a playbook, templates, and a 30-day plan',
    'mini-ebook': 'a focused field guide',
  })[p.type] || 'a curated pack';
  return `${p.blurb || p.title}. Includes ${inside}. Instant digital download (Markdown + HTML), lifetime access and free updates. 30-day refund.`.slice(0, 500);
}

export async function runStripeLister(opts = {}) {
  if (!hasStripeCreds()) {
    logger.dbg('stripe-lister: STRIPE_API_KEY not set — skipping');
    return { summary: 'stripe key not set (no-op)', ok: true, skipped: true };
  }

  const products = readJson(join(paths.data, 'products.json'), { items: [] }).items || [];
  const buyFile = join(paths.data, 'buy-links.json');
  const buy = readJson(buyFile, {});
  const max = opts.count || 3;
  const listed = [];
  let backfilled = 0;

  for (const p of products) {
    // Backfill existing Stripe products that lack a cover image — add default cover.
    const existing = buy[p.slug];
    if (existing && existing.platform === 'stripe' && existing.productId && !existing.cover) {
      try {
        await updateProduct(existing.productId, { image: DEFAULT_COVER, description: richDescription(p) });
        existing.cover = DEFAULT_COVER;
        writeJson(buyFile, buy);
        backfilled++;
        logger.ok(`stripe: backfilled cover/description for ${p.slug}`);
      } catch (e) { logger.warn(`stripe backfill ${p.slug}: ${e.message}`); }
    }
    if (listed.length >= max) continue;
    if (existing) continue;                            // already listed (Stripe or Gumroad)
    if (!existsSync(join(paths.output, 'products', p.slug))) continue;

    try {
      // Build the buyer deliverable (idempotent) so a download exists post-purchase.
      makeBundle(p.slug, p.title);
      const cover = buy[p.slug]?.cover || DEFAULT_COVER;
      const link = await createPaymentLink({
        name: p.title,
        description: richDescription(p),
        priceUsd: p.price || 19,
        slug: p.slug,
        image: cover,
      });
      buy[p.slug] = {
        url: link.url,
        platform: 'stripe',
        price: p.price || 19,
        productId: link.productId,
        cover,
      };
      writeJson(buyFile, buy);
      listed.push({ slug: p.slug, url: link.url });
      logger.ok(`stripe: listed ${p.slug} → ${link.url}`);
    } catch (e) {
      logger.err(`stripe: list failed for ${p.slug}: ${e.message}`);
      break; // stop on API error (bad key / rate) — retry next run
    }
  }

  return { summary: `listed ${listed.length}, backfilled ${backfilled}`, listed, ok: true };
}
