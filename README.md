# Profit Engine

**Autonomous, multi-stream revenue engine.** Zero-input operation. Detects trends, generates SEO content with affiliate hooks, produces digital starter packs, ships daily signal digests, and deploys the whole thing to GitHub Pages on a cron — all without a human in the loop.

Built to compound. Every cycle adds to the archive, increases search surface, and stacks revenue paths.

---

## What it does

| Stream | Frequency | Output | Monetization |
| --- | --- | --- | --- |
| **Trend signals** | every 30 min (when scheduled locally) / every 4h on Actions | `data/signals*.json`, `output/digests/*.md`, `public/api/signals.json` | Free API + Premium signal feed |
| **Affiliate content** | every 4 hours | SEO articles in `output/articles/*.md`, rendered to `public/articles/*.html` | Affiliate links (Amazon, etc.), ad zones, lead magnets |
| **Digital products** | daily | Packs in `output/products/<slug>/` (prompts, checklists, starter kits, mini-ebooks) + sales pages | One-time sales via Gumroad / Payhip |
| **Viral factory** | every 6 hours | Twitter threads, LinkedIn posts, TikTok hooks, Reddit headlines in `output/social/*.md` | Audience growth → newsletter → sponsorships |

The engine ships its own static site to GitHub Pages: index, article archive, digest archive, product sales pages, pricing tiers, signup form, sitemap, RSS feed, free JSON API.

## How to run

### Local

```bash
# one-shot full run
node src/engine/core.js --all

# just one stream
node src/engine/core.js --only trends --force
node src/engine/core.js --only content --force
node src/engine/core.js --only products --force
node src/engine/core.js --only viral --force

# rebuild site only
node scripts/build-site.js
```

No dependencies. Pure Node 20+ stdlib.

### Autonomous (GitHub Actions)

`.github/workflows/engine.yml` runs the engine on a cron and deploys the site to GitHub Pages. Free tier covers ~2000 minutes/month — plenty.

**To activate:**
1. Push this repo to GitHub.
2. Enable Pages (Settings → Pages → Source: GitHub Actions).
3. Optional: add provider API keys as secrets (see below) to upgrade content quality.

That's it. The engine then publishes 24/7.

## Configuration (all optional, all upgrades — engine runs without any of this)

### AI providers

Engine tries them in order, falls back to template generation if none are set.

| Env var | Provider | Free tier? |
| --- | --- | --- |
| `GROQ_API_KEY` | Groq (fastest, llama 3.3 70B) | Yes |
| `CEREBRAS_API_KEY` | Cerebras | Yes |
| `OPENROUTER_API_KEY` | OpenRouter (aggregator) | Yes (free models) |
| `OPENAI_API_KEY` | OpenAI | No |
| `ANTHROPIC_API_KEY` | Anthropic Claude | No |

Recommended: **start with Groq** — fastest, generous free tier.

### Monetization hooks

| Env var | Purpose |
| --- | --- |
| `AMAZON_ASSOC_TAG` | Inserts your Amazon Associates tag into every product link |
| `SPONSOR_URL` | URL or mailto for sponsorship CTAs |

Affiliate links work as generic search links if no tag is set — you still capture intent, just without commission until you plug your tag in.

### Ad zones

The HTML reserves `<div class="ad-zone">` slots in every article. Paste a Carbon Ads / EthicalAds / AdSense embed into `scripts/build-site.js` (search `AD_ZONE`) and revenue starts flowing on next deploy.

### Newsletter

`public/subscribe.html` has a Formspree-style form. Set the `action=` URL to:
- a Formspree form ID, or
- a ConvertKit/Buttondown embed, or
- your own webhook.

Newsletter subscribers are the highest-LTV asset this engine produces.

### Digital product fulfillment

Product packs land in `output/products/<slug>/` with everything packaged: payload markdown, README, license, sales page. To monetize:

1. Create a free Gumroad or Payhip account.
2. Upload each pack (zip the directory).
3. Link the buy button on the auto-generated sales page.

The engine can be extended to call Gumroad's API to auto-upload — drop your key in and it ships products without further input.

## Architecture

```
src/
  engine/
    core.js          ← orchestrator (entry point)
    sources.js       ← Reddit, HN, GitHub, Lobsters, dev.to, Product Hunt RSS
    trends.js        ← ranking, topic extraction, opportunity scoring
    monetize.js      ← affiliate links, CTAs, ad zones
  streams/
    affiliate-content.js
    digital-products.js
    trend-signals.js
    viral-factory.js
  ai/
    providers.js     ← Groq / Cerebras / OpenRouter / OpenAI / Anthropic / template fallback
  lib/
    util.js          ← fs, json, http, logging
scripts/
  build-site.js      ← markdown → HTML → public/
data/                ← state, manifests, metrics
output/              ← raw generated markdown
public/              ← built site, deployed to GitHub Pages
```

## Revenue paths (ranked by friction)

1. **Affiliate links** — already in every article. Add `AMAZON_ASSOC_TAG` and commissions start.
2. **Display ads** — paste a Carbon / EthicalAds embed.
3. **Newsletter sponsorships** — once you have ~500 subs.
4. **Digital pack sales** — upload to Gumroad/Payhip, link buy button.
5. **Premium signals API** — gate `/api/signals-premium.json` behind a paywall.
6. **Sponsorship slot** — direct sales via `SPONSOR_URL`.

## What still needs you (one-time, ~30 min total)

- Push to GitHub and enable Pages.
- Sign up for one free LLM provider (Groq recommended) and add its key as a secret.
- Sign up for Amazon Associates (free, instant if approved) and add `AMAZON_ASSOC_TAG`.
- Sign up for Formspree (free) and point the subscribe form at it.

After that the engine compounds untouched. Every 4 hours it scans, scores, writes, and publishes.

## Philosophy

- No deps. Pure stdlib. Future-proof. No supply chain risk.
- Free first. Every revenue path has a free entry point so it ships without billing setup.
- Template fallback. Engine never blocks on missing keys.
- Public by default. The site IS the product. Search traffic compounds.
- Daily output. Search engines reward freshness.

---

*This README was last hand-edited before the engine was given control. The engine writes everything else from here.*
