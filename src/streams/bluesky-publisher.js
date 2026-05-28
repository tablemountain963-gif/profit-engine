// Bluesky publisher stream. Posts one unposted social pack as a thread per run.
// No-op when creds absent. Tracks posted packs in data/posted.json (key: bluesky).
import { logger, paths, readJson, writeJson, nowIso } from '../lib/util.js';
import { hasBlueskyCreds, postThread } from '../engine/publishers/bluesky.js';
import { siteBaseUrl } from '../engine/seo.js';
import { join } from 'node:path';

const POSTED_FILE = join(paths.data, 'posted.json');

export async function runBlueskyPublisher(opts = {}) {
  if (!hasBlueskyCreds()) {
    logger.dbg('bluesky-publisher: creds not set — skipping');
    return { summary: 'bluesky creds not set (no-op)', ok: true, skipped: true };
  }

  const manifest = readJson(join(paths.data, 'social.json'), { items: [] });
  const posted = readJson(POSTED_FILE, {});
  const done = new Set((posted.bluesky || []).map(p => p.slug));

  const candidates = (manifest.items || []).filter(s => !done.has(s.slug));
  const max = opts.count || 1;
  const results = [];

  for (const item of candidates) {
    if (results.length >= max) break;
    const pack = readJson(join(paths.output, item.file.replace(/\.md$/, '.json')), null);
    const thread = pack?.pack?.twitter_thread;
    if (!Array.isArray(thread) || thread.length === 0) continue;

    const cta = `More signal like this, daily and free → ${siteBaseUrl()}/subscribe.html`;
    const posts = [...thread.slice(0, 8), cta];

    try {
      const { ids, url } = await postThread(posts);
      posted.bluesky = posted.bluesky || [];
      posted.bluesky.unshift({ slug: item.slug, topic: item.topic, ids, url, postedAt: nowIso() });
      posted.bluesky = posted.bluesky.slice(0, 500);
      writeJson(POSTED_FILE, posted);
      results.push({ slug: item.slug, posts: ids.length, url });
      logger.ok(`bluesky: posted ${item.slug} (${ids.length} posts) ${url}`);
    } catch (e) {
      logger.err(`bluesky: post failed for ${item.slug}: ${e.message}`);
      break;
    }
  }

  return { summary: results.length ? `posted ${results.length} thread(s)` : 'nothing to post', posted: results, ok: true };
}
