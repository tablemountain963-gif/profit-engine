// Core utilities. Pure stdlib. No deps.
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..');
export const paths = {
  root: ROOT,
  data: join(ROOT, 'data'),
  output: join(ROOT, 'output'),
  public: join(ROOT, 'public'),
  state: join(ROOT, 'data', 'state.json'),
  metrics: join(ROOT, 'data', 'metrics.json'),
  log: join(ROOT, 'data', 'engine.log'),
};

export function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

export function writeJson(file, obj) {
  ensureDir(dirname(file));
  writeFileSync(file, JSON.stringify(obj, null, 2));
}

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeText(file, text) {
  ensureDir(dirname(file));
  writeFileSync(file, text);
}

export function readText(file, fallback = '') {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return fallback;
  }
}

export function appendLog(line) {
  ensureDir(dirname(paths.log));
  const stamp = new Date().toISOString();
  const entry = `[${stamp}] ${line}\n`;
  try {
    writeFileSync(paths.log, entry, { flag: 'a' });
  } catch { /* ignore */ }
}

const colors = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', grn: '\x1b[32m', yel: '\x1b[33m',
  blu: '\x1b[34m', mag: '\x1b[35m', cyn: '\x1b[36m',
};

export function log(level, msg, meta) {
  const c = { info: colors.cyn, ok: colors.grn, warn: colors.yel, err: colors.red, dbg: colors.dim }[level] || '';
  const tag = `[${level.toUpperCase()}]`;
  const m = meta ? ` ${JSON.stringify(meta)}` : '';
  console.log(`${c}${tag}${colors.reset} ${msg}${colors.dim}${m}${colors.reset}`);
  appendLog(`${tag} ${msg}${m}`);
}

export const logger = {
  info: (m, x) => log('info', m, x),
  ok: (m, x) => log('ok', m, x),
  warn: (m, x) => log('warn', m, x),
  err: (m, x) => log('err', m, x),
  dbg: (m, x) => log('dbg', m, x),
};

export function hash(s) {
  return createHash('sha256').update(String(s)).digest('hex').slice(0, 12);
}

export function slugify(s) {
  return String(s).toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

export function pick(arr, n = 1) {
  if (!arr || arr.length === 0) return n === 1 ? null : [];
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return n === 1 ? shuffled[0] : shuffled.slice(0, n);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export async function fetchJson(url, opts = {}) {
  const timeout = opts.timeout || 15000;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = {
      'User-Agent': 'profit-engine/0.1 (+github)',
      'Accept': 'application/json,text/plain,*/*',
      ...(opts.headers || {}),
    };
    const r = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
    const ct = r.headers.get('content-type') || '';
    return ct.includes('json') ? await r.json() : await r.text();
  } finally {
    clearTimeout(id);
  }
}

export async function fetchText(url, opts = {}) {
  const timeout = opts.timeout || 15000;
  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeout);
  try {
    const headers = {
      'User-Agent': 'profit-engine/0.1 (+github)',
      'Accept': 'text/html,application/xhtml+xml,*/*',
      ...(opts.headers || {}),
    };
    const r = await fetch(url, { ...opts, headers, signal: ctrl.signal });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
    return await r.text();
  } finally {
    clearTimeout(id);
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(f => !ext || f.endsWith(ext)).map(f => join(dir, f));
}

export function fileAge(file) {
  try { return Date.now() - statSync(file).mtimeMs; } catch { return Infinity; }
}

// Simple state machine for engine progress.
export function loadState() {
  return readJson(paths.state, { runs: 0, lastRun: null, streams: {}, totals: { posts: 0, products: 0, signals: 0 } });
}

export function saveState(state) {
  writeJson(paths.state, state);
}

export function bumpMetric(stream, key, n = 1) {
  const s = loadState();
  s.streams[stream] ??= {};
  s.streams[stream][key] = (s.streams[stream][key] || 0) + n;
  if (s.totals[key] !== undefined) s.totals[key] += n;
  saveState(s);
}
