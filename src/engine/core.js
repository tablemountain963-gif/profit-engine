// Profit Engine — autonomous multi-stream orchestrator.
// Runs each stream on schedule, aggregates output, builds the public site.
import { logger, loadState, saveState, nowIso, paths, ensureDir } from '../lib/util.js';
import { describeProviders } from '../ai/providers.js';
import { runAffiliateContent } from '../streams/affiliate-content.js';
import { runDigitalProducts } from '../streams/digital-products.js';
import { runTrendSignals } from '../streams/trend-signals.js';
import { runViralFactory } from '../streams/viral-factory.js';
import { runXPublisher } from '../streams/x-publisher.js';
import { pullAll } from './sources.js';
import { resolveAgainst } from './feedback.js';
import { topNiches } from './memory.js';
import { buildSite } from '../../scripts/build-site.js';

const STREAMS = {
  trends: { name: 'trend-signals', fn: runTrendSignals, every: 30 * 60_000 },
  content: { name: 'affiliate-content', fn: runAffiliateContent, every: 4 * 60 * 60_000 },
  products: { name: 'digital-products', fn: runDigitalProducts, every: 24 * 60 * 60_000 },
  viral: { name: 'viral-factory', fn: runViralFactory, every: 6 * 60 * 60_000 },
  xpost: { name: 'x-publisher', fn: runXPublisher, every: 12 * 60 * 60_000 },
};

function shouldRun(state, streamKey) {
  const s = STREAMS[streamKey];
  const last = state.streams[s.name]?.lastRunAt;
  if (!last) return true;
  return (Date.now() - new Date(last).getTime()) >= s.every;
}

async function runStream(streamKey, state, opts = {}) {
  const s = STREAMS[streamKey];
  logger.info(`▶ running stream: ${s.name}`);
  try {
    const result = await s.fn(opts);
    state.streams[s.name] = {
      ...(state.streams[s.name] || {}),
      lastRunAt: nowIso(),
      lastResult: result?.summary || 'ok',
      totalRuns: ((state.streams[s.name]?.totalRuns) || 0) + 1,
    };
    logger.ok(`✓ ${s.name}: ${result?.summary || 'done'}`);
    return result;
  } catch (e) {
    state.streams[s.name] = {
      ...(state.streams[s.name] || {}),
      lastError: e.message,
      lastErrorAt: nowIso(),
    };
    logger.err(`✗ ${s.name} failed: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

export async function runEngine(opts = {}) {
  ensureDir(paths.data);
  ensureDir(paths.output);
  ensureDir(paths.public);

  const state = loadState();
  state.runs = (state.runs || 0) + 1;
  state.lastRun = nowIso();

  logger.info(`▷ Profit Engine run #${state.runs}`);
  logger.dbg(`AI providers: ${JSON.stringify(describeProviders())}`);

  // Feedback loop: resolve pending topics against current fresh trends.
  // Topics that reappear = traction (win). Stale topics that don't = loss.
  try {
    const fresh = await pullAll({ timeframe: 'day' });
    const fb = resolveAgainst(fresh);
    if (fb.wins || fb.losses) {
      logger.ok(`feedback resolved: +${fb.wins}/-${fb.losses}`);
    }
    const winners = topNiches(3);
    if (winners.length > 0) {
      logger.dbg(`top niches: ${winners.map(n => `${n.niche}(${n.wins}w/${n.losses}l)`).join(', ')}`);
    }
  } catch (e) {
    logger.warn(`feedback resolution skipped: ${e.message}`);
  }

  const force = opts.force || opts.all;
  const onlyStream = opts.only;
  const results = {};

  for (const key of Object.keys(STREAMS)) {
    if (onlyStream && key !== onlyStream) continue;
    if (!force && !shouldRun(state, key)) {
      logger.dbg(`skip ${key} (not due yet)`);
      continue;
    }
    results[key] = await runStream(key, state, opts);
  }

  saveState(state);

  // Always rebuild the site so latest content is published.
  try {
    const summary = await buildSite();
    logger.ok(`site built: ${summary}`);
  } catch (e) {
    logger.warn(`site build failed: ${e.message}`);
  }

  logger.info(`▶ Engine run complete. Streams executed: ${Object.keys(results).length}`);
  return { state, results };
}

// CLI entry.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('core.js')) {
  const args = process.argv.slice(2);
  const opts = {
    all: args.includes('--all'),
    force: args.includes('--force') || args.includes('--all'),
    only: (() => {
      const i = args.indexOf('--only');
      return i >= 0 ? args[i + 1] : null;
    })(),
  };
  runEngine(opts).then(() => process.exit(0)).catch(e => {
    logger.err(`engine crash: ${e.stack || e.message}`);
    process.exit(1);
  });
}
