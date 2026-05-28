// Stripe auto-lister stream. For each generated product not yet listed, ensures a
// buyer bundle exists, creates a Stripe Payment Link, and records it in
// data/buy-links.json so build-site wires a live "Buy now" button. No-op without key.
import { logger, paths, readJson, writeJson } from '../lib/util.js';
import { hasStripeCreds, createPaymentLink } from '../engine/publishers/stripe.js';
import { makeBundle } from '../../scripts/make-bundle.js';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

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

  for (const p of products) {
    if (listed.length >= max) break;
    if (buy[p.slug]) continue;                       // already listed (Stripe or Gumroad)
    if (!existsSync(join(paths.output, 'products', p.slug))) continue;

    try {
      // Build the buyer deliverable (idempotent) so a download exists post-purchase.
      makeBundle(p.slug, p.title);
      const cover = buy[p.slug]?.cover || undefined;
      const link = await createPaymentLink({
        name: p.title,
        description: p.blurb,
        priceUsd: p.price || 19,
        slug: p.slug,
        image: cover,
      });
      buy[p.slug] = {
        url: link.url,
        platform: 'stripe',
        price: p.price || 19,
        productId: link.productId,
        ...(cover ? { cover } : {}),
      };
      writeJson(buyFile, buy);
      listed.push({ slug: p.slug, url: link.url });
      logger.ok(`stripe: listed ${p.slug} → ${link.url}`);
    } catch (e) {
      logger.err(`stripe: list failed for ${p.slug}: ${e.message}`);
      break; // stop on API error (bad key / rate) — retry next run
    }
  }

  return { summary: listed.length ? `listed ${listed.length}` : 'nothing to list', listed, ok: true };
}
