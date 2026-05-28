// Mastodon publisher. Free API, bearer-token auth, no credits/paywall. No deps.
//
// Required env:
//   MASTODON_INSTANCE      e.g. https://mastodon.social  (your instance base URL)
//   MASTODON_ACCESS_TOKEN  app access token with "write:statuses" scope
import { logger } from '../../lib/util.js';

export function hasMastodonCreds() {
  return !!(process.env.MASTODON_INSTANCE && process.env.MASTODON_ACCESS_TOKEN);
}

function instanceBase() {
  return (process.env.MASTODON_INSTANCE || '').replace(/\/$/, '');
}

// Post one status. opts.replyTo = status id to chain a thread.
export async function postStatus(text, opts = {}) {
  if (!hasMastodonCreds()) throw new Error('Mastodon creds not set');
  const body = { status: clampToot(text), visibility: opts.visibility || 'public' };
  if (opts.replyTo) body.in_reply_to_id = opts.replyTo;
  const r = await fetch(`${instanceBase()}/api/v1/statuses`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MASTODON_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
      // Idempotency key avoids dup posts on retry.
      'Idempotency-Key': opts.idempotency || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mastodon ${r.status}: ${JSON.stringify(data)}`);
  return data; // { id, url, ... }
}

// Post array of strings as a thread (each replies to previous).
export async function postThread(toots, opts = {}) {
  const ids = []; let url0 = null;
  let replyTo = opts.replyTo || null;
  for (const t of toots) {
    if (!t || !t.trim()) continue;
    const res = await postStatus(t, replyTo ? { replyTo } : {});
    ids.push(res.id);
    if (!url0) url0 = res.url;
    replyTo = res.id;
    await sleep(1200);
  }
  return { ids, url: url0 };
}

// Mastodon default limit 500 chars (instance-configurable). Trim on word boundary.
function clampToot(text) {
  const t = String(text).trim();
  if (t.length <= 480) return t;
  return t.slice(0, 477).replace(/\s+\S*$/, '') + '…';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function describeMastodonStatus() {
  return { configured: hasMastodonCreds(), instance: instanceBase() || null };
}
