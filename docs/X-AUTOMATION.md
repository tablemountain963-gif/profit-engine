> ⚠️ **X free API blocks posting (2026).** With valid OAuth 1.0a creds, `POST /2/tweets`
> returns `402 CreditsDepleted` — X gated write behind paid plans (Basic ~$200/mo).
> The X poster works the instant the account has write credits, but for **free**
> autonomous posting use **Mastodon** (below) — same generated content, no paywall.

---

# Automated X (Twitter) Posting

The engine already writes X threads (viral-factory → `output/social/*.json`). With X API
credentials set, it posts one thread per run (every ~12h), appends a CTA linking to the
newsletter, and tracks what it posted in `data/posted.json`. No creds = no-op.

## One-time setup (~10 min)

### 1. Create an X developer app
1. Go to https://developer.x.com/en/portal/dashboard → sign in with the brand account (@solmercer).
2. Create a Project + App (free tier is fine — 500 posts/month write).
3. In the app's **User authentication settings**:
   - App permissions: **Read and write**
   - Type of app: **Web App / Automated App or Bot**
   - Callback URL / Website: your site URL (any valid URL)
4. Go to **Keys and tokens**:
   - Copy **API Key** + **API Key Secret** (consumer key/secret)
   - Generate **Access Token** + **Access Token Secret** (must show "Read and Write")

> If you regenerate keys after changing permissions, the old tokens lose write access — regenerate the Access Token AFTER setting "Read and write".

### 2. Add the 4 secrets

```bash
gh secret set X_API_KEY        --repo tablemountain963-gif/profit-engine
gh secret set X_API_SECRET     --repo tablemountain963-gif/profit-engine
gh secret set X_ACCESS_TOKEN   --repo tablemountain963-gif/profit-engine
gh secret set X_ACCESS_SECRET  --repo tablemountain963-gif/profit-engine
```

### 3. Done

Next engine run with social packs in the queue posts a thread automatically.

## What it posts

- The 7-tweet thread from the freshest unposted social pack (viral-factory output).
- A final CTA tweet: `More signal like this, daily and free → <site>/subscribe.html`
- Posts as a proper thread (each tweet replies to the previous).
- 1 pack per run, ~12h cadence → ~2 threads/day, well under the 500/month free cap.

## Limits & notes

- Free tier: 500 posts/month, 1 app. Each thread = ~8 posts → ~60 threads/month. Plenty.
- On any API error (rate limit / auth), it stops that run and retries the queue next cycle.
- Tweets auto-trimmed to 280 chars on a word boundary.
- Posted packs tracked in `data/posted.json` (never double-posts).

## Manual / one-off

```bash
node src/engine/core.js --only xpost --force   # post one queued thread now (needs creds in env)
```

---

# Mastodon Posting (FREE — recommended)

Mastodon's API is free, no credits, single bearer token. The engine posts the same
generated threads here every ~12h (`toot` stream). No-op without creds.

## Setup (~3 min)

1. Sign in / create account on any instance (e.g. https://mastodon.social).
2. Settings → **Development** → **New application**.
   - Application name: `Profit Engine`
   - Scopes: tick **write:statuses** (read is on by default; that's enough).
   - Submit.
3. Open the app → copy **Your access token**.
4. Add 2 secrets:

```bash
gh secret set MASTODON_INSTANCE       --repo tablemountain963-gif/profit-engine   # e.g. https://mastodon.social
gh secret set MASTODON_ACCESS_TOKEN   --repo tablemountain963-gif/profit-engine
```

Next run posts a thread automatically. Tracked in `data/posted.json` (key `mastodon`).

Manual: `node src/engine/core.js --only toot --force` (needs creds in env).

---

# Bluesky Posting (FREE — recommended)

Free AT Protocol API, app-password auth (never your main password). The `skeet`
stream posts the same threads ~2×/day at peak ET hours. No-op without creds.

## Setup (~2 min)
1. Bluesky → Settings → **App Passwords** → Add App Password → copy it.
2. Add 2 secrets:
```bash
gh secret set BLUESKY_HANDLE        --repo tablemountain963-gif/profit-engine   # e.g. solmercer.bsky.social
gh secret set BLUESKY_APP_PASSWORD  --repo tablemountain963-gif/profit-engine
```
Manual: `node src/engine/core.js --only skeet --force`

---

# Posting cadence & quality (current)

- **Peak-time crons:** runs at 13:00 / 16:00 / 21:00 / 01:00 UTC (9a/12p/5p/9p ET).
  Social publishers fire ~7h apart → land on the 9am + 5pm ET peaks.
- **Content quality:** viral threads use draft→self-critique→rewrite + few-shot hook
  examples; articles use few-shot specificity bar. Set `CEREBRAS_API_KEY` so quality
  survives Groq's daily quota (free, separate quota).
- Networks live: X (`xpost`, pay-per-use), Mastodon (`toot`, free), Bluesky (`skeet`, free).

## Future
- **LinkedIn** — packs include `pack.linkedin`; needs OAuth2 + page.
- **Visual cards per post** — needs a PNG rasterizer dep (@resvg/resvg-js) + media upload; deferred (text-first outperforms per 2026 algo data).
