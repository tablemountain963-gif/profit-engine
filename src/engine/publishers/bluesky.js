// Bluesky publisher. AT Protocol, app-password auth, pure Node. Free, no paywall.
//
// Required env:
//   BLUESKY_HANDLE        e.g. solmercer.bsky.social
//   BLUESKY_APP_PASSWORD  app password (Settings → App Passwords — NOT your main password)
//   BLUESKY_PDS           optional, default https://bsky.social
import { logger } from '../../lib/util.js';

export function hasBlueskyCreds() {
  return !!(process.env.BLUESKY_HANDLE && process.env.BLUESKY_APP_PASSWORD);
}
function pds() { return (process.env.BLUESKY_PDS || 'https://bsky.social').replace(/\/$/, ''); }

async function createSession() {
  const r = await fetch(`${pds()}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.BLUESKY_HANDLE, password: process.env.BLUESKY_APP_PASSWORD }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`bluesky auth ${r.status}: ${JSON.stringify(data)}`);
  return { jwt: data.accessJwt, did: data.did };
}

async function createRecord(session, record) {
  const r = await fetch(`${pds()}/xrpc/com.atproto.repo.createRecord`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${session.jwt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: session.did, collection: 'app.bsky.feed.post', record }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`bluesky post ${r.status}: ${JSON.stringify(data)}`);
  return data; // { uri, cid }
}

// Post a thread (array of strings). Chains replies via root/parent refs.
export async function postThread(posts, opts = {}) {
  if (!hasBlueskyCreds()) throw new Error('Bluesky creds not set');
  const session = await createSession();
  const ids = []; let root = null; let parent = null; let url0 = null;
  for (const p of posts) {
    if (!p || !p.trim()) continue;
    const record = { '$type': 'app.bsky.feed.post', text: clampPost(p), createdAt: new Date().toISOString() };
    if (root && parent) record.reply = { root, parent };
    const res = await createRecord(session, record);
    const ref = { uri: res.uri, cid: res.cid };
    if (!root) root = ref;
    parent = ref;
    ids.push(res.uri);
    if (!url0) url0 = postUrl(res.uri);
    await sleep(900);
  }
  return { ids, url: url0 };
}

function postUrl(uri) {
  // at://did/app.bsky.feed.post/rkey -> https://bsky.app/profile/<handle>/post/<rkey>
  const rkey = uri.split('/').pop();
  return `https://bsky.app/profile/${process.env.BLUESKY_HANDLE}/post/${rkey}`;
}

// Bluesky limit 300 graphemes (approx chars). Trim on word boundary.
function clampPost(text) {
  const t = String(text).trim();
  if (t.length <= 300) return t;
  return t.slice(0, 297).replace(/\s+\S*$/, '') + '…';
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function describeBlueskyStatus() {
  return { configured: hasBlueskyCreds(), pds: pds() };
}
