// Topic memory + opportunity blacklist.
// Engine remembers which topics it wrote recently and avoids near-duplicates.
// Powers the feedback loop: winners get amplified, losers get retired.
import { readJson, writeJson, paths, logger, nowIso, slugify } from '../lib/util.js';
import { join } from 'node:path';

const MEMORY_FILE = join(paths.data, 'memory.json');
const HORIZON_DAYS = 14;

function load() {
  return readJson(MEMORY_FILE, {
    topics: {},        // keyword -> { lastSeen, count, wins, losses }
    niches: {},        // niche -> { count, wins, losses }
    blacklist: [],     // explicit topic skips
  });
}

function save(m) { writeJson(MEMORY_FILE, m); }

export function recordTopic(keyword, niche = 'general', kind = 'attempt') {
  const m = load();
  const k = canonical(keyword);
  m.topics[k] ??= { firstSeen: nowIso(), lastSeen: null, count: 0, wins: 0, losses: 0, niche };
  m.topics[k].lastSeen = nowIso();
  m.topics[k].count += 1;
  if (kind === 'win') m.topics[k].wins += 1;
  if (kind === 'loss') m.topics[k].losses += 1;
  m.niches[niche] ??= { count: 0, wins: 0, losses: 0 };
  m.niches[niche].count += 1;
  if (kind === 'win') m.niches[niche].wins += 1;
  if (kind === 'loss') m.niches[niche].losses += 1;
  save(m);
}

export function isRecent(keyword, days = 7) {
  const m = load();
  const t = m.topics[canonical(keyword)];
  if (!t || !t.lastSeen) return false;
  const ageDays = (Date.now() - new Date(t.lastSeen).getTime()) / (86400 * 1000);
  return ageDays < days;
}

export function isBlacklisted(keyword) {
  const m = load();
  return m.blacklist.includes(canonical(keyword));
}

// Filter list of opportunities, removing recently-seen or blacklisted ones.
export function filterFresh(opps, opts = {}) {
  const days = opts.days || 7;
  return opps.filter(o => {
    const kw = o.keyword || o.topic || '';
    if (isBlacklisted(kw)) return false;
    if (isRecent(kw, days)) return false;
    return true;
  });
}

// Score multiplier from niche performance — wins amplify, losses dampen.
export function nicheBias(niche) {
  const m = load();
  const stats = m.niches[niche];
  if (!stats || stats.count < 3) return 1.0;
  const ratio = (stats.wins + 1) / (stats.losses + 1);
  return Math.max(0.5, Math.min(2.0, ratio));
}

export function topNiches(n = 5) {
  const m = load();
  return Object.entries(m.niches)
    .map(([k, v]) => ({ niche: k, ...v, score: (v.wins + 1) / (v.losses + 1) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}

function canonical(kw) {
  return slugify(String(kw).toLowerCase());
}

export function pruneMemory() {
  // Drop topics last seen > HORIZON_DAYS ago AND with no wins (free up surface).
  const m = load();
  const cutoff = Date.now() - HORIZON_DAYS * 86400 * 1000;
  const before = Object.keys(m.topics).length;
  for (const [k, t] of Object.entries(m.topics)) {
    if (!t.lastSeen) continue;
    const lastSeenMs = new Date(t.lastSeen).getTime();
    if (lastSeenMs < cutoff && (t.wins || 0) === 0) {
      delete m.topics[k];
    }
  }
  const after = Object.keys(m.topics).length;
  if (before !== after) {
    logger.dbg(`memory pruned: ${before} -> ${after} topics`);
    save(m);
  }
}
