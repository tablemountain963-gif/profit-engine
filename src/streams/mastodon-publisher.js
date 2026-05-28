// Mastodon publisher stream. Posts one unposted social pack as a thread per run.
// No-op when creds absent. Tracks posted packs in data/posted.json (key: mastodon).
import { logger, paths, readJson, writeJson, nowIso } from '../lib/util.js';
import { hasMastodonCreds, postThread } from '../engine/publishers/mastodon.js';
import { siteBaseUrl } from '../engine/seo.js';
import { join } from 'node:path';

const POSTED_FILE = join(paths.data, 'posted.json');

export async function runMastodonPublisher(opts = {}) {
  if (!hasMastodonCreds()) {
    logger.dbg('mastodon-publisher: creds not set — skipping');
    return { summary: 'mastodon creds not set (no-op)', ok: true, skipped: true };
  }

  const manifest = readJson(join(paths.data, 'social.json'), { items: [] });
  const posted = readJson(POSTED_FILE, {});
  const postedSlugs = new Set((posted.mastodon || []).map(p => p.slug));

  const candidates = (manifest.items || []).filter(s => !postedSlugs.has(s.slug));
  const max = opts.count || 1;
  const results = [];

  for (const item of candidates) {
    if (results.length >= max) break;
    const packFile = join(paths.output, item.file.replace(/\.md$/, '.json'));
    const pack = readJson(packFile, null);
    const thread = pack?.pack?.twitter_thread; // reuse the thread copy
    if (!Array.isArray(thread) || thread.length === 0) continue;

    const cta = `More signal like this, daily and free → ${siteBaseUrl()}/subscribe.html`;
    const toots = [...thread.slice(0, 8), cta];

    try {
      const { ids, url } = await postThread(toots);
      posted.mastodon = posted.mastodon || [];
      posted.mastodon.unshift({ slug: item.slug, topic: item.topic, ids, url, postedAt: nowIso() });
      posted.mastodon = posted.mastodon.slice(0, 500);
      writeJson(POSTED_FILE, posted);
      results.push({ slug: item.slug, toots: ids.length, url });
      logger.ok(`mastodon: posted ${item.slug} (${ids.length} toots) ${url}`);
    } catch (e) {
      logger.err(`mastodon: post failed for ${item.slug}: ${e.message}`);
      break;
    }
  }

  return {
    summary: results.length ? `posted ${results.length} thread(s)` : 'nothing to post',
    posted: results,
    ok: true,
  };
}
