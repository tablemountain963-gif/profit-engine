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

## Other platforms (future)

The same publisher pattern extends to:
- **LinkedIn** — packs already include a LinkedIn post (`pack.linkedin`). LinkedIn API needs OAuth2 + company page.
- **Mastodon** — simplest API (single access token, POST /api/v1/statuses). Good next target.
- **Buffer / Typefully** — if you'd rather schedule via a tool, their APIs accept the generated packs.
