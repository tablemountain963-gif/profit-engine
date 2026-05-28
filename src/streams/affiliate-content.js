// Affiliate content stream.
// Pipeline: trend pull → opportunity selection → article generation → monetize injection → publish.
import { logger, paths, writeJson, readJson, writeText, slugify, todayKey, nowIso, ensureDir, hash } from '../lib/util.js';
import { pullAll } from '../engine/sources.js';
import { selectOpportunities } from '../engine/trends.js';
import { complete } from '../ai/providers.js';
import { injectMonetization } from '../engine/monetize.js';
import { filterFresh, recordTopic, pruneMemory } from '../engine/memory.js';
import { schedulePending } from '../engine/feedback.js';
import { join } from 'node:path';

const ARTICLES_DIR = join(paths.output, 'articles');
const FRONT_MATTER = (meta) => `---
title: "${meta.title.replace(/"/g, '\\"')}"
date: ${meta.date}
slug: ${meta.slug}
niche: ${meta.niche}
keywords: [${meta.keywords.map(k => `"${k}"`).join(', ')}]
source_topic: "${meta.topic.replace(/"/g, '\\"')}"
score: ${meta.score}
---

`;

export async function runAffiliateContent(opts = {}) {
  ensureDir(ARTICLES_DIR);
  const target = opts.count || 3;
  logger.info(`affiliate content stream: targeting ${target} articles`);

  pruneMemory();
  const items = await pullAll({ timeframe: 'day' });
  const rawOpps = selectOpportunities(items, target * 6);
  const opps = filterFresh(rawOpps, { days: 7 });
  logger.info(`opportunities: ${rawOpps.length} raw → ${opps.length} fresh`);

  const generated = [];
  const seen = loadSeenSlugs();

  for (const opp of opps) {
    if (generated.length >= target) break;
    const topic = humanizeKeyword(opp.keyword);
    const slug = slugify(`${topic}-${todayKey()}`);
    if (seen.has(slug)) continue;

    try {
      const article = await generateArticle(topic, opp);
      const out = saveArticle(article);
      generated.push(out);
      seen.add(slug);
      recordTopic(opp.keyword, opp.niches?.[0] || 'general', 'attempt');
      schedulePending(opp.keyword, opp.niches?.[0] || 'general');
      logger.ok(`generated: ${article.meta.slug}`);
    } catch (e) {
      logger.warn(`article fail (${topic}): ${e.message}`);
    }
  }

  // Build index file so the site can list them.
  rebuildIndex();

  return {
    summary: `${generated.length} articles`,
    generated: generated.map(g => g.meta.slug),
    ok: true,
  };
}

function humanizeKeyword(kw) {
  return kw.replace(/[_-]/g, ' ').split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

async function generateArticle(topic, opp) {
  const sys = `You are an expert affiliate content writer. You write SEO-optimized, value-first long-form articles. Style: clear, concrete, helpful, no fluff. Length: 900-1400 words. Include sections with H2 headers. Mention specific product categories where relevant so affiliate links can be inserted. Avoid making up brand specifics — use category language.`;
  const examplesText = (opp.examples || []).slice(0, 3).map(e => `- ${e.title} (${e.source})`).join('\n');
  const user = `Write a comprehensive article about: ${topic}

Context — trending signals from across the web include:
${examplesText}

Requirements:
- Hook the reader in the first 2 sentences
- Include H2 sections: Overview, Why It Matters, How to Start, Common Pitfalls, Recommendations
- In Recommendations, mention 3-5 product CATEGORIES (not specific brands) so affiliate links can be inserted
- Conclude with a clear next step
- Use markdown
- Target keyword density natural, focus on user value`;

  const { provider, text } = await complete(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { maxTokens: 2200, temperature: 0.75 }
  );

  const title = extractTitle(text) || topic;
  const slug = slugify(`${topic}-${todayKey()}-${hash(text).slice(0, 6)}`);

  const meta = {
    title,
    slug,
    date: todayKey(),
    niche: opp.niches?.[0] || 'general',
    keywords: [topic, ...(opp.niches || [])].slice(0, 8),
    topic,
    score: Math.round((opp.score || 0) * 100) / 100,
    provider,
    generatedAt: nowIso(),
  };

  // Strip duplicate title heading if AI emitted one
  let body = text.replace(/^#\s+.+\n/, '').trim();

  // Inject monetization (affiliate links, CTAs, ad zones)
  body = injectMonetization(body, topic, { products: deriveProductQueries(topic, opp), slug });

  return { meta, body };
}

function deriveProductQueries(topic, opp) {
  const niche = opp.niches?.[0];
  const base = [
    `${topic} starter kit`,
    `best ${topic} tools`,
    `${topic} for beginners`,
  ];
  if (niche === 'gear') base.unshift(`${topic} accessories`);
  if (niche === 'ai') base.unshift(`${topic} subscription`);
  if (niche === 'health') base.unshift(`${topic} essentials`);
  return base;
}

function extractTitle(text) {
  const h1 = text.match(/^#\s+(.+)$/m);
  return h1 ? h1[1].trim() : null;
}

function saveArticle({ meta, body }) {
  const md = FRONT_MATTER(meta) + body;
  const filePath = join(ARTICLES_DIR, `${meta.slug}.md`);
  writeText(filePath, md);
  // Also append to manifest
  const manifest = readJson(join(paths.data, 'articles.json'), { items: [] });
  manifest.items.unshift({
    slug: meta.slug,
    title: meta.title,
    date: meta.date,
    niche: meta.niche,
    keywords: meta.keywords,
    score: meta.score,
    file: `articles/${meta.slug}.md`,
  });
  manifest.items = manifest.items.slice(0, 500); // cap
  writeJson(join(paths.data, 'articles.json'), manifest);
  return { meta, file: filePath };
}

function loadSeenSlugs() {
  const m = readJson(join(paths.data, 'articles.json'), { items: [] });
  return new Set(m.items.map(it => it.slug));
}

function persistSeen() { /* manifest already updated by saveArticle */ }

function rebuildIndex() {
  // Stub — actual rebuild done by scripts/build-site.js
}
