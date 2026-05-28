# Activate Revenue — 4 Steps (~15 min)

The engine is running. Site is live. Content is publishing autonomously.

To convert that activity into money, do these four things once. Then never touch it again.

---

## 1. Get a free Groq key (2 min) — upgrades content quality 10×

Without an LLM key the engine uses templated content. With Groq's free tier it generates real articles.

1. Visit https://console.groq.com — sign in with Google (no card).
2. Create an API key.
3. Add it as a repo secret:

```bash
gh secret set GROQ_API_KEY --repo tablemountain963-gif/profit-engine
# paste the key
```

The next scheduled run will use it automatically.

## 2. Amazon Associates tag (5 min) — affiliate commissions on every product link

1. Apply at https://affiliate-program.amazon.com (instant for most regions; 180 days to first sale).
2. Copy your tracking ID (e.g. `mytag-20`).
3. Add as secret:

```bash
gh secret set AMAZON_ASSOC_TAG --repo tablemountain963-gif/profit-engine
# paste tag
```

Every link the engine writes now carries your tag.

## 3. Email capture (3 min) — newsletter subscribers compound forever

1. Sign up at https://formspree.io — free for 50 submissions/month, free Buttondown for the actual newsletter.
2. Create a form, copy the form ID (looks like `xyzabc12`).
3. Edit the live subscribe page:

```bash
# In public/subscribe.html (regenerate from build), or set in build-site.js,
# replace YOUR_FORM_ID with the Formspree ID.
```

Or simpler: edit `scripts/build-site.js`, search `YOUR_FORM_ID`, replace, commit, push. Workflow rebuilds and redeploys.

## 4. Ad zone (5 min) — display ads pay per view, no clicks needed

1. Apply at https://www.ethicalads.io (developer-friendly, fast review) — OR https://www.carbonads.net.
2. Paste their embed snippet into `scripts/build-site.js` where `AD_ZONE` is referenced.
3. Commit + push.

Every article served now serves ads.

---

## What happens next (no action needed)

- **Every 4 hours**: engine runs, generates 1-3 articles, drafts social packs, refreshes trend feed.
- **Every day**: engine generates a digital product (prompts, checklists, starter kits).
- **Always**: site is live at https://tablemountain963-gif.github.io/profit-engine/

The system compounds. Each cycle:
- Adds search surface (more long-tail keywords indexed)
- Adds newsletter content (more subscriber-acquisition surface)
- Adds product inventory (more checkout paths)
- Adds social drafts (more growth experiments)

---

## Optional revenue upgrades (do later when traffic exists)

| Effort | Path | Trigger to add |
| --- | --- | --- |
| 10 min | Gumroad/Payhip product uploads | After first 50 site visitors |
| 30 min | Premium API tier paywall | After ~100 daily API hits |
| 30 min | Sponsor slot direct sales | After ~500 newsletter subs |
| 1 hour | Stripe-paywalled premium digest | After first sponsor reply |
| 2 hours | Connect Buffer/Typefully to auto-post social packs | When you have a posting cadence |

---

## Watching it work

- **Live site**: https://tablemountain963-gif.github.io/profit-engine/
- **Free API**: https://tablemountain963-gif.github.io/profit-engine/api/signals.json
- **Actions runs**: https://github.com/tablemountain963-gif/profit-engine/actions
- **State snapshot**: https://tablemountain963-gif.github.io/profit-engine/engine-state.json
