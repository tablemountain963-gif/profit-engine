// Viral content factory.
// Builds short-form content drafts (Twitter/X threads, LinkedIn posts, TikTok/Reels hooks)
// from detected trend opportunities. Output is queued for manual posting OR
// integration with social publishing APIs (Buffer/Typefully/Hypefury) when keys present.
import { logger, paths, writeJson, readJson, writeText, slugify, todayKey, nowIso, ensureDir } from '../lib/util.js';
import { complete } from '../ai/providers.js';
import { pullAll } from '../engine/sources.js';
import { selectOpportunities } from '../engine/trends.js';
import { join } from 'node:path';

const VIRAL_DIR = join(paths.output, 'social');

export async function runViralFactory(opts = {}) {
  ensureDir(VIRAL_DIR);
  const target = opts.count || 3;
  logger.info(`viral factory: targeting ${target} content units`);

  const items = await pullAll({ timeframe: 'day' });
  const opps = selectOpportunities(items, target * 2);

  const generated = [];
  const seen = new Set((readJson(join(paths.data, 'social.json'), { items: [] }).items || []).map(s => s.slug));

  for (const opp of opps) {
    if (generated.length >= target) break;
    const topic = humanize(opp.keyword);
    const slug = slugify(`${topic}-${todayKey()}`);
    if (seen.has(slug)) continue;

    try {
      const pack = await generateContentPack(topic, opp);
      pack.slug = slug;
      pack.date = todayKey();
      saveContentPack(pack);
      generated.push(pack);
      seen.add(slug);
      logger.ok(`viral pack: ${pack.slug}`);
    } catch (e) {
      logger.warn(`viral fail (${topic}): ${e.message}`);
    }
  }

  return { summary: `${generated.length} content packs`, generated: generated.map(p => p.slug), ok: true };
}

async function generateContentPack(topic, opp) {
  const sys = `You produce viral short-form content packs. For each topic you generate 4 formats: a 7-tweet X/Twitter thread, a LinkedIn post (180-240 words), a TikTok/Reels hook (3 hook variants), and a Reddit comment-bait headline. Style: concrete, hook-forward, no hype, no emoji unless format demands.`;
  const user = `Topic: ${topic}

Context — recent signals:
${(opp.examples || []).slice(0, 3).map(e => `- ${e.title}`).join('\n')}

Output as JSON with keys: twitter_thread (array of 7 strings), linkedin (string), tiktok_hooks (array of 3 strings), reddit_headline (string). No commentary outside JSON. Output valid JSON only.`;

  const { text, provider } = await complete(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { maxTokens: 1800, temperature: 0.8 }
  );

  // Parse JSON. If model wrapped it, extract.
  const parsed = tryParseJson(text) || templatePack(topic);

  return {
    topic,
    provider,
    generatedAt: nowIso(),
    pack: parsed,
    niche: opp.niches?.[0] || 'general',
  };
}

function tryParseJson(text) {
  // Find first { and last }
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a < 0 || b < 0) return null;
  try {
    return JSON.parse(text.slice(a, b + 1));
  } catch {
    return null;
  }
}

function templatePack(topic) {
  return {
    twitter_thread: [
      `${topic} matters more than people think. Here's why → 🧵`,
      `1/ The default approach to ${topic} wastes time and money.`,
      `2/ The cause: most resources oversimplify or assume too much.`,
      `3/ The fix is three moves: survey, default, iterate.`,
      `4/ Survey: find the 3 leading options, ignore long-tail.`,
      `5/ Default: pick one that covers 80% of cases.`,
      `6/ Iterate: time-box a trial, measure honestly.`,
      `7/ That's it. Save this thread for later.`,
    ],
    linkedin: `${topic} is one of those topics where most takes are either too generic or too in-the-weeds.\n\nHere is a framework that has worked in practice: start with a survey, pick a default, iterate on a trial window. The point is to make the first decision quickly, then learn from doing.\n\nIf you are evaluating ${topic} right now and feeling stuck, the cheapest mistake is overthinking. Pick the option that covers the most cases, set a date when you will review it, and start.\n\nWhat is your current default?`,
    tiktok_hooks: [
      `Stop overthinking ${topic} — here's the 3-move framework`,
      `${topic} mistake everyone makes (and how to skip it)`,
      `${topic} in 60 seconds: what actually matters`,
    ],
    reddit_headline: `I spent 6 months testing ${topic} so you don't have to. Here's what actually worked.`,
  };
}

function humanize(kw) {
  return kw.replace(/[_-]/g, ' ').split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}

function saveContentPack(pack) {
  const file = join(VIRAL_DIR, `${pack.slug}.json`);
  writeJson(file, pack);

  // Also save a human-readable markdown
  const md = `---
title: "${pack.topic} — Social Content Pack"
slug: ${pack.slug}
date: ${pack.date}
niche: ${pack.niche}
type: social-pack
---

# ${pack.topic} — Social Content Pack

## X / Twitter Thread

${(pack.pack.twitter_thread || []).map((t, i) => `${i + 1}. ${t}`).join('\n')}

## LinkedIn

${pack.pack.linkedin || ''}

## TikTok / Reels Hooks

${(pack.pack.tiktok_hooks || []).map((h, i) => `${i + 1}. ${h}`).join('\n')}

## Reddit Headline

${pack.pack.reddit_headline || ''}
`;
  writeText(file.replace(/\.json$/, '.md'), md);

  const manifest = readJson(join(paths.data, 'social.json'), { items: [] });
  manifest.items.unshift({
    slug: pack.slug,
    topic: pack.topic,
    date: pack.date,
    niche: pack.niche,
    file: `social/${pack.slug}.md`,
  });
  manifest.items = manifest.items.slice(0, 200);
  writeJson(join(paths.data, 'social.json'), manifest);
}
