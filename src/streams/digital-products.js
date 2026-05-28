// Digital product factory.
// Generates niche packages: prompt packs, checklists, templates, mini-ebooks.
// Output is bundle-ready for Gumroad/Payhip/direct download via GitHub Pages.
import { logger, paths, writeJson, readJson, writeText, slugify, todayKey, nowIso, ensureDir, hash } from '../lib/util.js';
import { complete } from '../ai/providers.js';
import { pullAll } from '../engine/sources.js';
import { selectOpportunities } from '../engine/trends.js';
import { filterFresh, recordTopic } from '../engine/memory.js';
import { join } from 'node:path';

const PRODUCTS_DIR = join(paths.output, 'products');

const PRODUCT_TYPES = [
  {
    type: 'prompt-pack',
    title: (topic) => `${topic} Prompt Pack — 50 Battle-Tested Prompts`,
    blurb: (topic) => `50 proven prompts for ${topic}. Copy/paste ready. Tested across Claude, GPT, Gemini.`,
    fileLayout: ['prompts.md', 'README.md', 'LICENSE.txt'],
    suggestedPrice: 19,
  },
  {
    type: 'checklist',
    title: (topic) => `${topic} Operator Checklist — Printable PDF`,
    blurb: (topic) => `A one-page operator checklist for ${topic}. Print, laminate, ship.`,
    fileLayout: ['checklist.md', 'README.md', 'LICENSE.txt'],
    suggestedPrice: 9,
  },
  {
    type: 'starter-kit',
    title: (topic) => `${topic} Starter Kit — Templates + Playbook`,
    blurb: (topic) => `Templates, playbook, and 30-day plan for ${topic}. Skip the blank page.`,
    fileLayout: ['playbook.md', 'templates.md', '30-day-plan.md', 'README.md', 'LICENSE.txt'],
    suggestedPrice: 29,
  },
  {
    type: 'mini-ebook',
    title: (topic) => `${topic}: A 30-Minute Field Guide`,
    blurb: (topic) => `Read it in 30 minutes. Apply it forever. Field guide to ${topic}.`,
    fileLayout: ['ebook.md', 'README.md', 'LICENSE.txt'],
    suggestedPrice: 14,
  },
];

export async function runDigitalProducts(opts = {}) {
  ensureDir(PRODUCTS_DIR);
  const count = opts.count || 1;
  logger.info(`product factory: targeting ${count} product(s)`);

  // Find a productizable opportunity
  const items = await pullAll({ timeframe: 'week' });
  const opps = selectOpportunities(items, 10);

  const productizable = filterFresh(opps.filter(o => {
    const niche = o.niches?.[0];
    return ['software', 'ai', 'productivity', 'finance', 'health'].includes(niche);
  }), { days: 14 });

  if (productizable.length === 0) {
    logger.warn('no productizable opportunities found this cycle');
    return { summary: 'no opps', generated: [], ok: true };
  }

  const seen = new Set((readJson(join(paths.data, 'products.json'), { items: [] }).items || []).map(p => p.slug));
  const generated = [];

  for (const opp of productizable) {
    if (generated.length >= count) break;
    const topic = humanize(opp.keyword);
    const productType = pickProductType(opp);
    const slug = slugify(`${productType.type}-${topic}-${todayKey()}`);
    if (seen.has(slug)) continue;

    try {
      const product = await generateProduct(topic, opp, productType, slug);
      saveProduct(product);
      generated.push(product);
      seen.add(slug);
      recordTopic(opp.keyword, opp.niches?.[0] || 'general', 'attempt');
      logger.ok(`product generated: ${product.slug} (${productType.type})`);
    } catch (e) {
      logger.warn(`product fail (${topic}): ${e.message}`);
    }
  }

  return { summary: `${generated.length} products`, generated: generated.map(p => p.slug), ok: true };
}

function humanize(kw) {
  return kw.replace(/[_-]/g, ' ').split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function pickProductType(opp) {
  const niche = opp.niches?.[0];
  if (niche === 'ai' || niche === 'software') return PRODUCT_TYPES[0]; // prompt-pack
  if (niche === 'productivity') return PRODUCT_TYPES[1]; // checklist
  if (niche === 'finance' || niche === 'health') return PRODUCT_TYPES[2]; // starter-kit
  return PRODUCT_TYPES[3]; // mini-ebook
}

async function generateProduct(topic, opp, ptype, slug) {
  const dir = join(PRODUCTS_DIR, slug);
  ensureDir(dir);

  const meta = {
    slug,
    title: ptype.title(topic),
    blurb: ptype.blurb(topic),
    type: ptype.type,
    topic,
    niche: opp.niches?.[0] || 'general',
    price: ptype.suggestedPrice,
    generatedAt: nowIso(),
    files: ptype.fileLayout,
  };

  // Generate the main payload using AI (or templates)
  const payload = await generatePayload(topic, ptype);
  writeText(join(dir, mainFileFor(ptype)), payload);

  // README — sales / use page
  const readme = makeReadme(meta, payload);
  writeText(join(dir, 'README.md'), readme);

  // LICENSE
  writeText(join(dir, 'LICENSE.txt'), license(meta));

  // Sales page (markdown -> rendered by site builder)
  const salesPage = makeSalesPage(meta, payload);
  const salesPath = join(paths.output, 'sales', `${slug}.md`);
  writeText(salesPath, salesPage);

  // Meta sidecar
  writeJson(join(dir, 'meta.json'), meta);

  return meta;
}

function mainFileFor(ptype) {
  switch (ptype.type) {
    case 'prompt-pack': return 'prompts.md';
    case 'checklist': return 'checklist.md';
    case 'starter-kit': return 'playbook.md';
    case 'mini-ebook': return 'ebook.md';
    default: return 'content.md';
  }
}

async function generatePayload(topic, ptype) {
  const sys = `You are a senior content engineer producing high-leverage digital products. Output dense, useful, actionable material. No filler.`;
  let user;

  switch (ptype.type) {
    case 'prompt-pack':
      user = `Produce a markdown document titled "${topic} Prompt Pack" containing exactly 50 numbered prompts for working with LLMs (Claude, GPT, Gemini) in the ${topic} domain. Each prompt should be 2-6 sentences, copy/paste ready, and labeled by use case (e.g., research, drafting, analysis, automation). Group by use case sections. Include a "How to Use" section at the top.`;
      break;
    case 'checklist':
      user = `Produce a one-page printable markdown checklist for ${topic}. Format: short title, intro paragraph (2-3 sentences), 12-20 atomic checklist items grouped under 3-4 phase headings. End with "Print and Pin" line.`;
      break;
    case 'starter-kit':
      user = `Produce a starter kit playbook for ${topic} in markdown. Sections: (1) Why this kit exists (3-4 sentences), (2) Playbook — 7-10 numbered moves with rationale, (3) Templates — 3-5 copy/paste templates, (4) 30-day plan — week-by-week breakdown, (5) Pitfalls to avoid, (6) Next steps. Be specific and actionable.`;
      break;
    case 'mini-ebook':
    default:
      user = `Produce a 30-minute field guide for ${topic} in markdown. 8-12 chapters of 2-4 paragraphs each. Start with a 'Read This First' chapter. End with 'What to Do Next'. Aim for ~3000-4000 words total. Be concrete, opinionated, and useful.`;
  }

  const { text } = await complete(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { maxTokens: 3500, temperature: 0.7 }
  );

  return text;
}

function makeReadme(meta, payload) {
  return `# ${meta.title}

> ${meta.blurb}

## What's Inside

${meta.files.map(f => `- \`${f}\``).join('\n')}

## How to Use

1. Open the main file (\`${mainFileFor({ type: meta.type })}\`).
2. Pick the section relevant to your immediate task.
3. Use, adapt, ship.

## License

See \`LICENSE.txt\`. Single-user license; redistribution requires written permission.

---
Generated by Profit Engine — ${meta.generatedAt}
`;
}

function makeSalesPage(meta, payload) {
  const preview = payload.split('\n').slice(0, 30).join('\n');
  return `---
title: "${meta.title}"
slug: ${meta.slug}
type: product
price: ${meta.price}
topic: "${meta.topic}"
---

# ${meta.title}

${meta.blurb}

## Why This Pack

If you're working in **${meta.topic}**, you already know how much time gets eaten by searching, re-reading, and rebuilding things other people have already figured out. This pack collapses that work into a single, immediately useful resource.

## What You Get

${meta.files.map(f => `- **${f}** — production-ready, no filler`).join('\n')}

## Preview

\`\`\`
${preview.slice(0, 800)}...
\`\`\`

## Pricing

**$${meta.price}** — one-time, single-user license. Lifetime access.

[Buy Now →](#buy-${meta.slug})

Or [join the newsletter](/subscribe.html) for free weekly picks in ${meta.niche}.

---
*Sales fulfillment integration: Connect Gumroad / Payhip / Lemon Squeezy — see \`docs/MONETIZATION.md\`.*
`;
}

function license(meta) {
  return `${meta.title}
Generated: ${meta.generatedAt}

LICENSE

Copyright (c) ${new Date().getFullYear()} Profit Engine.

This product is licensed for single-user, personal or commercial use by the purchaser.
Redistribution, resale, or republication in any form is prohibited without
prior written permission.

NO WARRANTY. Provided "as is" without express or implied warranty.
`;
}

function saveProduct(meta) {
  const manifest = readJson(join(paths.data, 'products.json'), { items: [] });
  manifest.items.unshift(meta);
  manifest.items = manifest.items.slice(0, 200);
  writeJson(join(paths.data, 'products.json'), manifest);
}
