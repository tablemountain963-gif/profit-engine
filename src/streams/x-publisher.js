// X publisher stream. Posts one unposted social pack as a thread per run.
// No-op when X creds absent. Tracks posted packs in data/posted.json.
import { logger, paths, readJson, writeJson, nowIso } from '../lib/util.js';
import { hasXCreds, postThread } from '../engine/publishers/x.js';
import { siteBaseUrl } from '../engine/seo.js';
import { join } from 'node:path';

const POSTED_FILE = join(paths.data, 'posted.json');

export async function runXPublisher(opts = {}) {
  if (!hasXCreds()) {
    logger.dbg('x-publisher: X creds not set — skipping');
    return { summary: 'x creds not set (no-op)', ok: true, skipped: true };
  }

  const manifest = readJson(join(paths.data, 'social.json'), { items: [] });
  const posted = readJson(POSTED_FILE, { x: [] });
  const postedSlugs = new Set((posted.x || []).map(p => p.slug));

  // Newest unposted pack with a usable thread.
  const candidates = (manifest.items || []).filter(s => !postedSlugs.has(s.slug));
  const max = opts.count || 1;
  const results = [];

  for (const item of candidates) {
    if (results.length >= max) break;
    const packFile = join(paths.output, item.file.replace(/\.md$/, '.json'));
    const pack = readJson(packFile, null);
    const thread = pack?.pack?.twitter_thread;
    if (!Array.isArray(thread) || thread.length === 0) continue;

    // Append a CTA tweet linking to the site (top-of-funnel → newsletter/products).
    const cta = `More signal like this, daily and free → ${siteBaseUrl()}/subscribe.html`;
    const tweets = [...thread.slice(0, 7), cta];

    try {
      const ids = await postThread(tweets);
      posted.x = posted.x || [];
      posted.x.unshift({ slug: item.slug, topic: item.topic, tweetIds: ids, postedAt: nowIso() });
      posted.x = posted.x.slice(0, 500);
      writeJson(POSTED_FILE, posted);
      results.push({ slug: item.slug, tweets: ids.length, firstId: ids[0] });
      logger.ok(`x-publisher: posted thread for ${item.slug} (${ids.length} tweets, id ${ids[0]})`);
    } catch (e) {
      logger.err(`x-publisher: post failed for ${item.slug}: ${e.message}`);
      // Stop on API error (rate limit / auth) — don't burn the whole queue.
      break;
    }
  }

  return {
    summary: results.length ? `posted ${results.length} thread(s)` : 'nothing to post',
    posted: results,
    ok: true,
  };
}
