# Monetization Playbook

Six revenue paths, each independent. Layer them.

## 1. Amazon Associates

**Effort:** 5 min · **Payoff:** scales with traffic

1. Apply at https://affiliate-program.amazon.com — instant approval for many regions, 180-day grace to make first sale.
2. Copy your tracking ID (e.g., `mytag-20`).
3. Add as repo secret `AMAZON_ASSOC_TAG`.
4. Every product link in every article now carries your tag.

Cookie: 24 hours. Anything they buy on Amazon in that window credits you.

## 2. Walmart / Etsy / AliExpress affiliate

**Effort:** 5-10 min · **Payoff:** longer cookies, often higher commission

- Walmart Affiliate (via Impact Radius) — up to 14-day cookie
- Etsy Affiliate — 30-day cookie
- AliExpress — tiered up to 9%

Add equivalents to `data/affiliates.json` and extend `src/engine/monetize.js`.

## 3. Display ads

**Effort:** 5 min · **Payoff:** CPM scales with pageviews

Recommended (developer-friendly, fast approval):
- **EthicalAds** — https://www.ethicalads.io — no banner blindness, low-friction.
- **Carbon Ads** — https://www.carbonads.net — high CPM, requires audit.
- **AdSense** — works but has stricter approval thresholds.

Paste the embed inside `scripts/build-site.js` where `AD_ZONE` appears.

## 4. Newsletter sponsorships

**Effort:** ongoing · **Payoff:** $200-2000 per send at scale

1. Connect `public/subscribe.html` to Formspree (free) or Buttondown (free up to 100 subs).
2. The daily digest doubles as your newsletter content (Buttondown can pull from RSS).
3. At ~500 subs in a niche, sponsors will start replying. Use ConvertKit Tip Jar or sponsor.indiehackers.com for early matchmaking.

## 5. Digital pack sales

**Effort:** 10 min/pack · **Payoff:** $9-29 per sale, scales

Free platforms (no fee on free plan or low cut):
- **Payhip** — 5% on free plan, has webhooks, EU VAT handled.
- **Gumroad** — 10% per sale, easiest setup.
- **Lemon Squeezy** — handles taxes globally, 5%.

Workflow:
1. Engine generates `output/products/<slug>/` with everything zipped-ready.
2. Upload zip to Payhip; copy the buy-button URL.
3. Edit the auto-generated sales page (`output/sales/<slug>.md`) to embed the buy button.

For full automation, add a `GUMROAD_API_KEY` and extend `src/streams/digital-products.js` to call their `POST /v2/products` endpoint.

## 6. Premium signal feed

**Effort:** 30 min · **Payoff:** recurring SaaS-style revenue

The engine writes `data/signals-premium.json` (full unredacted data) every run. To paywall:

**Option A — Cloudflare Worker:** stand up a worker that gates the JSON behind a Stripe-managed subscription.

**Option B — Manual:** offer it as a paid email send via Buttondown's paid tier.

**Option C — Mintlify/Stoplight:** generate hosted API docs and use a paid tier on Stripe Apps.

## Compound effects

Each path feeds the others:

- Articles → search traffic → ad views + affiliate clicks
- Articles → newsletter subs → sponsor revenue
- Digests → premium API conversions
- Social packs → audience growth → all above

The point is to let each cycle pile output onto the previous. Stay in the game long enough and the archive itself becomes the moat.
