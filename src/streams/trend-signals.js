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

function digestHumanize(kw) {
  return String(kw).replace(/[_-]/g, ' ').split(' ').filter(Boolean)
    .map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
}
function digestSource(s) {
  return ({ hackernews: 'Hacker News', reddit: 'Reddit', github: 'GitHub', lobsters: 'Lobsters',
    devto: 'DEV.to', producthunt: 'Product Hunt', mastodon: 'Mastodon', npm: 'npm', pypi: 'PyPI',
    gnews: 'Google News' }[s] || (s || 'web'));
}

async function composeDigest(signal) {
  const date = todayKey();
  const top = signal.topItems.slice(0, 7);
  const topics = signal.topics.slice(0, 8);
  const opps = signal.opportunities.slice(0, 5);

  // Optional AI-written intro (2-3 sentences). Validated — ignored on fallback.
  let intro = '';
  try {
    const sys = `Write one tight paragraph (2-3 sentences) introducing a daily tech/market trend digest. No hype, no emojis, no lists, no headings.`;
    const user = `Date ${date}. Leading items today:\n${top.slice(0, 5).map(i => `- ${i.title}`).join('\n')}\nFrame what's moving today in 2-3 sentences.`;
    const { text, provider } = await complete(
      [{ role: 'system', content: sys }, { role: 'user', content: user }],
      { maxTokens: 220, temperature: 0.6, kind: 'digest', topicHint: `digest ${date}` }
    );
    if (provider !== 'template' && text && !/placeholder/i.test(text) && text.length > 40) {
      intro = text.trim().replace(/^#+\s.*$/gm, '').trim();
    }
  } catch { /* deterministic body still renders */ }

  const sc = s => Math.round((s || 0) * 100) / 100;
  const body = `# Daily Trend Digest — ${date}

${intro ? intro + '\n\n' : ''}## Today in 30 seconds

${top.slice(0, 3).map(i => `- ${i.title}`).join('\n') || '- Quiet day across tracked sources.'}

## Picks worth your click

${top.map((i, ix) => `${ix + 1}. [${i.title}](${i.url}) — ${digestSource(i.source)} · score ${sc(i.score)}`).join('\n')}

## Topics rising

${topics.length ? topics.map(t => `- **${digestHumanize(t.keyword)}** — ${t.count} mentions${t.niches?.[0] && t.niches[0] !== 'general' ? ` · ${t.niches[0]}` : ''}`).join('\n') : '- No strong clusters today.'}

## Opportunity radar

${opps.length ? opps.map(o => `- **${digestHumanize(o.keyword)}** — ${o.opportunity?.recommended || 'worth a closer look'}`).join('\n') : '- Nothing actionable surfaced today.'}
`;

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

  return front + body + cta;
}

function appendArchive(entry) {
  const m = readJson(join(paths.data, 'digests.json'), { items: [] });
  // One digest file per date — replace same-date entry instead of appending dups.
  m.items = (m.items || []).filter(it => it.date !== entry.date);
  m.items.unshift(entry);
  m.items = m.items.slice(0, 365);
  writeJson(join(paths.data, 'digests.json'), m);
}
