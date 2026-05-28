// Feedback loop — derives win/loss signals without any backend.
// If a topic the engine published about REAPPEARS in fresh trend pulls within
// a window, it's a "traction" win. If it never reappears within the window, it's
// a quiet loss. The bias multiplier in memory.js then steers future scoring.
import { readJson, writeJson, paths, logger, slugify, nowIso } from '../lib/util.js';
import { recordTopic } from './memory.js';
import { join } from 'node:path';

const WINDOW_DAYS = 5;       // how long after publish to wait for traction
const RESOLVE_FILE = join(paths.data, 'feedback-pending.json');

// Schedule a topic for traction resolution. Called after publish.
export function schedulePending(keyword, niche) {
  const f = readJson(RESOLVE_FILE, { pending: [] });
  f.pending.push({
    keyword: slugify(String(keyword)),
    niche: niche || 'general',
    publishedAt: nowIso(),
  });
  writeJson(RESOLVE_FILE, f);
}

// Resolve pending items against fresh trend items. Called by core.js after pulls.
export function resolveAgainst(freshItems) {
  const f = readJson(RESOLVE_FILE, { pending: [] });
  if (!f.pending || f.pending.length === 0) return { wins: 0, losses: 0 };

  // Build lookup of fresh items' keywords
  const haystack = new Set();
  for (const it of freshItems) {
    const text = `${it.title || ''} ${it.selftext || it.desc || ''}`.toLowerCase();
    for (const word of text.match(/[a-z]{4,}/g) || []) haystack.add(word);
    if (it.title) haystack.add(slugify(it.title));
  }

  const now = Date.now();
  const cutoff = now - WINDOW_DAYS * 86400 * 1000;
  const stillPending = [];
  let wins = 0, losses = 0;

  for (const p of f.pending) {
    const tokens = String(p.keyword).split('-').filter(t => t.length > 3);
    const matched = tokens.some(t => haystack.has(t));
    const age = now - new Date(p.publishedAt).getTime();

    if (matched) {
      // Traction — topic reappeared. Win.
      recordTopic(p.keyword, p.niche, 'win');
      wins++;
    } else if (age >= WINDOW_DAYS * 86400 * 1000) {
      // Window closed without resurfacing. Loss.
      recordTopic(p.keyword, p.niche, 'loss');
      losses++;
    } else {
      stillPending.push(p);
    }
  }

  writeJson(RESOLVE_FILE, { pending: stillPending });
  if (wins || losses) logger.ok(`feedback: +${wins} wins, -${losses} losses (${stillPending.length} pending)`);
  return { wins, losses, pending: stillPending.length };
}
