# Deployment

The engine is built to run autonomously on GitHub Actions. ~5 minutes of setup unlocks indefinite operation.

## One-time setup (5 min)

### 1. Create the repo

```bash
gh repo create profit-engine --public --source=. --remote=origin --push
```

### 2. Enable GitHub Pages

```
Settings → Pages → Source: GitHub Actions
```

### 3. Add provider key (recommended)

Get a free Groq API key (https://console.groq.com) — instant, no card.

```bash
gh secret set GROQ_API_KEY
# paste key
```

### 4. (Optional) Amazon Associates tag

```bash
gh secret set AMAZON_ASSOC_TAG
# paste e.g. mytag-20
```

### 5. Trigger first run

```bash
gh workflow run profit-engine
```

Or wait — the cron runs every 4 hours automatically.

## What happens autonomously

Every scheduled trigger:

1. GitHub Actions checks out the repo.
2. Runs `node src/engine/core.js --all`.
3. The engine:
   - Scans 25+ public trend sources
   - Ranks and scores opportunities
   - Generates 1-3 new articles (4h cadence) with affiliate links injected
   - Generates 1 new digital product (daily)
   - Drafts 1-3 social content packs (6h cadence)
   - Writes daily signal digest
4. Engine commits all generated files back to the repo.
5. Site builder renders markdown → HTML.
6. Deploys to GitHub Pages.

Free Actions tier: 2000 min/month. Each run takes ~3-8 min. That's 250-650 free runs/month — more than enough.

## Custom domain (optional)

```
Settings → Pages → Custom domain: yourdomain.com
```

Add the suggested CNAME at your registrar. Google indexes custom domains faster than `*.github.io`.

## Verification

After first run, check:
- `https://<username>.github.io/profit-engine/` loads
- `/articles.html` lists generated articles
- `/api/signals.json` returns trend data
- `/feed.xml` validates as RSS

## Local development

```bash
node src/engine/core.js --all       # full run
node scripts/build-site.js          # rebuild site only
node src/engine/core.js --only trends --force
```

Generated files appear under `output/` and `public/`.

## Adding revenue paths after launch

See `docs/MONETIZATION.md` — each path can be added without redeploying. Most just need a secret added or a single line in `src/engine/monetize.js`.
