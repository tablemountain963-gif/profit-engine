// X (Twitter) API v2 publisher. OAuth 1.0a user-context signing, pure Node crypto.
// Posts single tweets and threads (chained replies). No deps.
//
// Required env (X developer app, OAuth 1.0a, "Read and write" permission):
//   X_API_KEY            (consumer key)
//   X_API_SECRET         (consumer secret)
//   X_ACCESS_TOKEN       (user access token)
//   X_ACCESS_SECRET      (user access token secret)
import { createHmac, randomBytes } from 'node:crypto';
import { logger } from '../../lib/util.js';

const TWEET_URL = 'https://api.twitter.com/2/tweets';

export function hasXCreds() {
  return !!(process.env.X_API_KEY && process.env.X_API_SECRET &&
            process.env.X_ACCESS_TOKEN && process.env.X_ACCESS_SECRET);
}

function pctEncode(s) {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// OAuth 1.0a Authorization header for a request.
// For application/json bodies, the JSON payload is NOT part of the signature base —
// only oauth_* params (and query params, none here).
function authHeader(method, url) {
  const oauth = {
    oauth_consumer_key: process.env.X_API_KEY,
    oauth_nonce: randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.X_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
  const paramStr = Object.keys(oauth).sort()
    .map(k => `${pctEncode(k)}=${pctEncode(oauth[k])}`).join('&');
  const baseStr = [method.toUpperCase(), pctEncode(url), pctEncode(paramStr)].join('&');
  const signingKey = `${pctEncode(process.env.X_API_SECRET)}&${pctEncode(process.env.X_ACCESS_SECRET)}`;
  const signature = createHmac('sha1', signingKey).update(baseStr).digest('base64');
  const all = { ...oauth, oauth_signature: signature };
  return 'OAuth ' + Object.keys(all).sort()
    .map(k => `${pctEncode(k)}="${pctEncode(all[k])}"`).join(', ');
}

// Post one tweet. opts.replyTo = tweet id to reply to (for threads).
export async function postTweet(text, opts = {}) {
  if (!hasXCreds()) throw new Error('X creds not set');
  const body = { text: clampTweet(text) };
  if (opts.replyTo) body.reply = { in_reply_to_tweet_id: opts.replyTo };
  const r = await fetch(TWEET_URL, {
    method: 'POST',
    headers: {
      'Authorization': authHeader('POST', TWEET_URL),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X ${r.status}: ${JSON.stringify(data)}`);
  return data.data; // { id, text }
}

// Post an array of strings as a thread (each replies to the previous).
export async function postThread(tweets, opts = {}) {
  const ids = [];
  let replyTo = opts.replyTo || null;
  for (const t of tweets) {
    if (!t || !t.trim()) continue;
    const res = await postTweet(t, replyTo ? { replyTo } : {});
    ids.push(res.id);
    replyTo = res.id;
    await sleep(1500); // gentle spacing
  }
  return ids;
}

// Delete a tweet by id (DELETE /2/tweets/:id).
export async function deleteTweet(id) {
  if (!hasXCreds()) throw new Error('X creds not set');
  const url = `${TWEET_URL}/${id}`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': authHeader('DELETE', url) },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`X delete ${r.status}: ${JSON.stringify(data)}`);
  return data;
}

// Delete a whole thread (reverse order — leaves no orphan replies).
export async function deleteThread(ids) {
  const out = [];
  for (const id of [...ids].reverse()) {
    try { await deleteTweet(id); out.push(id); await sleep(800); }
    catch (e) { logger.warn(`x delete ${id} fail: ${e.message}`); }
  }
  return out;
}

// X hard limit 280 chars. Trim safely on word boundary.
function clampTweet(text) {
  const t = String(text).trim();
  if (t.length <= 280) return t;
  return t.slice(0, 277).replace(/\s+\S*$/, '') + '…';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export function describeXStatus() {
  return { configured: hasXCreds() };
}
