// Trend signal stream.
// Outputs:
//   - data/signals.json (machine-readable feed for the site/API)
//   - output/digests/YYYY-MM-DD.md (daily newsletter-ready digest)
//   - public/api/signals.json (live API endpoint via GitHub Pages)
import { logger, paths, writeJson, readJson, writeText, todayKey, nowIso, ensureDir } from '../lib/util.js';
import { pullAll } from '../engine/sources.js';
import { rankItems, extractTopics, selectOpportunities } from '../engine/trends.js';
import { complete } from '../ai/providers.js';
import { join } from 'node:path';

const DIGEST_DIR = join(paths.output, 'digests');
const API_DIR = join(paths.public, 'api');

export async function runTrendSignals(opts = {}) {
  ensureDir(DIGEST_DIR);
  ensureDir(API_DIR);

  const items = await pullAll({ timeframe: 'day' });
  const ranked = rankItems(items);
  const topics = extractTopics(ranked, 20);
  const opportunities = selectOpportunities(items, 8);

  const signal = {
    generatedAt: nowIso(),
    sourceCount: items.length,
    topItems: ranked.slice(0, 25).map(i => ({
      title: i.title,
      url: i.url,
      score: Math.round(i._score * 100) / 100,
      niche: i._niche,
      source: i.source,
      engagement: { score: i.score, comments: i.comments },
    })),
    topics: topics.slice(0, 15),
    opportunities,
  };

  // 1. Write public API (free tier)
  writeJson(join(API_DIR, 'signals.json'), {
    generatedAt: signal.generatedAt,
    tier: 'free',
    top: signal.topItems.slice(0, 10),
    topics: signal.topics.slice(0, 5),
  });

  // 2. Write premium feed (gated server-side or via paywall, full data)
  writeJson(join(paths.data, 'signals-premium.json'), signal);

  // 3. Generate digest (markdown newsletter)
  const digest = await composeDigest(signal);
  const digestFile = join(DIGEST_DIR, `${todayKey()}.md`);
  writeText(digestFile, digest);

  // 4. Append to archive index
  appendArchive({ date: todayKey(), file: `digests/${todayKey()}.md`, topItems: signal.topItems.length });

  logger.ok(`signals: ${signal.topItems.length} items, ${topics.length} topics, ${opportunities.length} opportunities`);

  return {
    summary: `${signal.topItems.length} items / ${topics.length} topics / ${opportunities.length} opps`,
    digestFile,
    ok: true,
  };
}

async function composeDigest(signal) {
  const date = todayKey();
  const top5 = signal.topItems.slice(0, 5);
  const oppList = signal.opportunities.slice(0, 5);
  const topicList = signal.topics.slice(0, 8);

  // Try AI synthesis. Falls back to structured template if no provider.
  const sys = `You write a crisp daily trend digest newsletter. Tone: signal > noise, no hype. 250-400 words. Markdown.`;
  const user = `Compose today's digest (${date}).

Top items (raw):
${top5.map((i, ix) => `${ix + 1}. ${i.title} (${i.source}, score ${i.score})\n   ${i.url}`).join('\n')}

Topic clusters: ${topicList.map(t => t.keyword).slice(0, 8).join(', ')}

Output sections:
1. **Today in 30 seconds** — 3 bullets
2. **Picks worth your click** — 3-5 items with one-sentence commentary
3. **Topics rising** — list with brief context
4. **Opportunity radar** — 1-2 sentences each on action-worthy opportunities

Be specific. No filler. No emojis.`;

  const { text } = await complete(
    [{ role: 'system', content: sys }, { role: 'user', content: user }],
    { maxTokens: 1500, temperature: 0.6, kind: 'digest', topicHint: `Daily Trend Digest ${date}` }
  );

  const front = `---
title: "Daily Trend Digest — ${date}"
date: ${date}
type: digest
slug: digest-${date}
---

`;

  const cta = `

---

## Subscribe

Get this digest in your inbox each morning — [subscribe to the newsletter](/subscribe.html).

## Premium Signals

Want the full opportunity scores, per-niche breakouts, and machine-readable API access? [Upgrade to Premium →](/pricing.html)
`;

  return front + text + cta;
}

function appendArchive(entry) {
  const m = readJson(join(paths.data, 'digests.json'), { items: [] });
  // One digest file per date — replace same-date entry instead of appending dups.
  m.items = (m.items || []).filter(it => it.date !== entry.date);
  m.items.unshift(entry);
  m.items = m.items.slice(0, 365);
  writeJson(join(paths.data, 'digests.json'), m);
}
