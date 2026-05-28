// Free public data sources for trend detection. No auth required.
import { fetchJson, fetchText, logger, hash } from '../lib/util.js';

const UA_HEADERS = { 'User-Agent': 'profit-engine/0.1 (research)' };

// ─── Reddit ────────────────────────────────────────────────
// Public JSON endpoints. Free, no auth.
export async function redditTop(subreddit, opts = {}) {
  const t = opts.t || 'day';
  const limit = opts.limit || 25;
  const url = `https://www.reddit.com/r/${subreddit}/top.json?t=${t}&limit=${limit}`;
  try {
    const data = await fetchJson(url, { headers: UA_HEADERS });
    return (data.data?.children || []).map(c => ({
      id: c.data.id,
      title: c.data.title,
      url: `https://reddit.com${c.data.permalink}`,
      score: c.data.score,
      comments: c.data.num_comments,
      subreddit: c.data.subreddit,
      created: c.data.created_utc,
      flair: c.data.link_flair_text,
      selftext: (c.data.selftext || '').slice(0, 500),
      source: 'reddit',
    }));
  } catch (e) {
    logger.warn(`reddit ${subreddit} fail: ${e.message}`);
    return [];
  }
}

// ─── Hacker News ───────────────────────────────────────────
export async function hnTop(limit = 30) {
  try {
    const ids = await fetchJson('https://hacker-news.firebaseio.com/v0/topstories.json');
    const slice = ids.slice(0, limit);
    const items = await Promise.all(slice.map(id =>
      fetchJson(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).catch(() => null)
    ));
    return items.filter(Boolean).map(it => ({
      id: `hn-${it.id}`,
      title: it.title || '',
      url: it.url || `https://news.ycombinator.com/item?id=${it.id}`,
      score: it.score || 0,
      comments: it.descendants || 0,
      created: it.time,
      source: 'hackernews',
    }));
  } catch (e) {
    logger.warn(`hn fail: ${e.message}`);
    return [];
  }
}

// ─── GitHub Trending ──────────────────────────────────────
// Search API. Has rate limit but generous for low-frequency use.
export async function githubTrending(lang = '', since = 7) {
  const date = new Date(Date.now() - since * 86400 * 1000).toISOString().slice(0, 10);
  const q = `created:>${date}${lang ? ` language:${lang}` : ''}`;
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`;
  try {
    const data = await fetchJson(url, { headers: { ...UA_HEADERS, Accept: 'application/vnd.github+json' } });
    return (data.items || []).map(r => ({
      id: `gh-${r.id}`,
      title: `${r.full_name} — ${r.description || ''}`.slice(0, 200),
      url: r.html_url,
      score: r.stargazers_count,
      comments: r.open_issues_count,
      lang: r.language,
      topics: r.topics || [],
      created: Math.floor(new Date(r.created_at).getTime() / 1000),
      source: 'github',
    }));
  } catch (e) {
    logger.warn(`github fail: ${e.message}`);
    return [];
  }
}

// ─── Lobsters ─────────────────────────────────────────────
export async function lobstersHot(limit = 25) {
  try {
    const data = await fetchJson(`https://lobste.rs/hottest.json`);
    return (data || []).slice(0, limit).map(it => ({
      id: `lob-${it.short_id}`,
      title: it.title,
      url: it.url || it.comments_url,
      score: it.score,
      comments: it.comment_count,
      tags: it.tags || [],
      created: Math.floor(new Date(it.created_at).getTime() / 1000),
      source: 'lobsters',
    }));
  } catch (e) {
    logger.warn(`lobsters fail: ${e.message}`);
    return [];
  }
}

// ─── DEV.to ───────────────────────────────────────────────
export async function devTo(limit = 30, tag = '') {
  const url = `https://dev.to/api/articles?per_page=${limit}&top=7${tag ? `&tag=${tag}` : ''}`;
  try {
    const data = await fetchJson(url);
    return (data || []).map(a => ({
      id: `dev-${a.id}`,
      title: a.title,
      url: a.url,
      score: a.public_reactions_count,
      comments: a.comments_count,
      tags: a.tag_list || [],
      created: Math.floor(new Date(a.created_at).getTime() / 1000),
      source: 'devto',
    }));
  } catch (e) {
    logger.warn(`devto fail: ${e.message}`);
    return [];
  }
}

// ─── ProductHunt RSS ──────────────────────────────────────
export async function productHuntRss() {
  try {
    const xml = await fetchText('https://www.producthunt.com/feed');
    return parseRssItems(xml).map(it => ({ ...it, source: 'producthunt' }));
  } catch (e) {
    logger.warn(`PH fail: ${e.message}`);
    return [];
  }
}

// ─── IndieHackers (RSS-ish via products endpoint) ─────────
// Falls back to community subreddit if upstream missing.
export async function indieHackersFallback() {
  return await redditTop('Entrepreneur', { t: 'week', limit: 15 });
}

// ─── Generic RSS Parser ───────────────────────────────────
function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  const tagRegex = (tag) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  let match;
  while ((match = itemRegex.exec(xml))) {
    const body = match[1];
    const title = (body.match(tagRegex('title')) || [])[1] || '';
    const link = (body.match(tagRegex('link')) || [])[1] || '';
    const desc = (body.match(tagRegex('description')) || [])[1] || '';
    const pub = (body.match(tagRegex('pubDate')) || [])[1] || '';
    items.push({
      id: hash(link || title),
      title: stripTags(title).slice(0, 200),
      url: stripTags(link),
      desc: stripTags(desc).slice(0, 400),
      score: 0,
      comments: 0,
      created: pub ? Math.floor(new Date(pub).getTime() / 1000) : Math.floor(Date.now() / 1000),
    });
    if (items.length >= 25) break;
  }
  return items;
}

function stripTags(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .trim();
}

// ─── Aggregate Pull ───────────────────────────────────────
// Fetches everything in parallel. Returns flattened list.
const NICHE_SUBREDDITS = [
  'sidehustle', 'passive_income', 'Entrepreneur', 'EntrepreneurRideAlong',
  'webdev', 'programming', 'selfhosted', 'productivity',
  'BuyItForLife', 'gadgets', 'tools', 'INEEEEDIT',
  'artificial', 'LocalLLaMA', 'ChatGPT', 'OpenAI',
  'personalfinance', 'investing', 'CryptoCurrency',
  'fitness', 'getmotivated', 'GetStudying',
];

export async function pullAll(opts = {}) {
  const subs = opts.subreddits || NICHE_SUBREDDITS;
  const t = opts.timeframe || 'day';
  logger.info(`pulling trend sources (${subs.length} subreddits + 5 others)`);

  const results = await Promise.allSettled([
    ...subs.map(s => redditTop(s, { t, limit: 10 })),
    hnTop(30),
    githubTrending('', 3),
    lobstersHot(25),
    devTo(30),
    productHuntRss(),
  ]);

  const flat = results
    .filter(r => r.status === 'fulfilled')
    .flatMap(r => r.value)
    .filter(x => x && x.title);

  logger.ok(`pulled ${flat.length} items across ${results.length} sources`);
  return flat;
}
