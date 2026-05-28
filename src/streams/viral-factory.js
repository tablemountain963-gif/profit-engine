// Viral content factory.
// Builds short-form content drafts (Twitter/X threads, LinkedIn posts, TikTok/Reels hooks)
// from detected trend opportunities. Output is queued for manual posting OR
// integration with social publishing APIs (Buffer/Typefully/Hypefury) when keys present.
import { logger, paths, writeJson, readJson, writeText, slugify, todayKey, nowIso, ensureDir } from '../lib/util.js';
import { complete } from '../ai/providers.js';
import { pullAll } from '../engine/sources.js';
import { selectOpportunities } from '../engine/trends.js';
import { filterFresh, recordTopic } from '../engine/memory.js';
import { join } from 'node:path';

const VIRAL_DIR = join(paths.output, 'social');

export async function runViralFactory(opts = {}) {
  ensureDir(VIRAL_DIR);
  const target = opts.count || 3;
  logger.info(`viral factory: targeting ${target} content units`);

  const items = await pullAll({ timeframe: 'day' });
  // Prefer commercial/niche/named topics for social — skip thin bigrams like "success won".
  const ranked = filterFresh(selectOpportunities(items, target * 6), { days: 5 });
  const strong = ranked.filter(o => o.proper || (o.niches || []).some(n => n !== 'general') || (o.opportunity?.type && o.opportunity.type !== 'editorial'));
  const opps = (strong.length >= target ? strong : ranked);

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
      recordTopic(opp.keyword, opp.niches?.[0] || 'general', 'attempt');
      logger.ok(`viral pack: ${pack.slug} (${pack.provider})`);
      await new Promise(r => setTimeout(r, 4000)); // space calls — stay under free-tier TPM
    } catch (e) {
      logger.warn(`viral fail (${topic}): ${e.message}`);
    }
  }

  return { summary: `${generated.length} content packs`, generated: generated.map(p => p.slug), ok: true };
}

async function generateContentPack(topic, opp) {
  const niche = opp.niches?.[0] || 'tech';
  const examples = (opp.examples || []).slice(0, 3).map(e => `- ${e.title}`).join('\n');

  // Engagement-optimized per 2026 X algorithm research:
  // - hook line 1 stops the scroll (number / contrarian claim), NO link, NO "🧵 here's why"
  // - 5-8 self-contained body posts, concrete specifics (not platitudes)
  // - final post is a QUESTION (replies weigh ~150x likes) + 1-2 hashtags max
  // - sophisticated audience rejects generic AI: be specific, opinionated, real
  const sys = `You are a sharp ${niche} operator who writes X threads that actually get replies. Voice: direct, specific, lightly contrarian, zero corporate fluff, zero hype words ("game-changer", "unlock", "leverage", "dive in"), no emoji except at most one. You NEVER write generic filler like "matters more than people think" or "here's why 🧵". Every line earns the next.`;

  const user = `Topic: ${topic}
Niche: ${niche}
Recent real signals on this:
${examples || '- (none)'}

Write an X thread + repurposes. Rules:
- Thread = 6 to 8 tweets, each under 270 chars, each self-contained.
- Tweet 1 = a scroll-stopping HOOK: lead with a specific number, a concrete claim, or a contrarian observation about ${topic}. No link. No "thread/🧵" label. No throat-clearing.
- Tweets 2..n-1 = concrete, specific substance — real tactics, numbers, named tools/approaches, a mistake to avoid. Not vague advice.
- Final tweet = a genuine QUESTION that invites a reply (ask the reader's experience/opinion) + 1-2 relevant lowercase hashtags.
- Do NOT put any URL in the thread.

Output ONLY valid JSON, keys:
  "twitter_thread": [strings],
  "linkedin": "180-240 word post, same substance, ends with a question",
  "tiktok_hooks": [3 punchy spoken hooks],
  "reddit_headline": "title that invites debate"`;

  const { text, provider } = await complete(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { maxTokens: 2000, temperature: 0.9, kind: 'social', topicHint: topic }
  );

  const parsed = tryParseJson(text);
  const pack = (parsed && Array.isArray(parsed.twitter_thread) && parsed.twitter_thread.length >= 4)
    ? parsed
    : templatePack(topic, niche);

  return {
    topic,
    provider,
    generatedAt: nowIso(),
    pack,
    niche,
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

function templatePack(topic, niche = 'tech') {
  const tag = (niche || 'tech').replace(/[^a-z0-9]/gi, '').toLowerCase();
  return {
    twitter_thread: [
      `Most people evaluating ${topic} burn a week before making a single decision. The fix takes an afternoon.`,
      `The trap: treating ${topic} like a research project. You don't need the perfect answer — you need a working default you can correct later.`,
      `Step 1: list only the 3 most-mentioned options. Ignore the long tail. If it's not in the top 3 conversations, it's noise right now.`,
      `Step 2: pick the one that covers ~80% of your cases. Write down WHY in one sentence. That sentence is your rollback plan if it fails.`,
      `Step 3: time-box a 14-day trial. Track one number that tells you if it's working. No number = no decision, just vibes.`,
      `The mistake almost everyone makes: optimizing before measuring. You can't tune what you haven't instrumented.`,
      `What's your current default for ${topic} — and what made you pick it? #${tag} #buildinpublic`,
    ],
    linkedin: `Everyone overcomplicates ${topic}.\n\nThe people who move fastest don't find the perfect option — they pick a sane default, write down why, and set a date to review it.\n\nThree moves: (1) shortlist the top 3 options, ignore the rest; (2) pick the one covering ~80% of cases; (3) time-box a 14-day trial against ONE metric.\n\nThe expensive mistake is optimizing before you measure. Instrument first, tune second.\n\nWhat's your current default for ${topic}, and what made you choose it?`,
    tiktok_hooks: [
      `You're overthinking ${topic}. Here's the afternoon version.`,
      `The ${topic} mistake that costs you a week — and the 3-step skip.`,
      `Stop researching ${topic}. Start a 14-day trial instead.`,
    ],
    reddit_headline: `Unpopular take: most ${topic} advice is overthinking. Pick a default, measure one number, move on. Change my mind.`,
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
