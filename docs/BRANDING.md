# Brand Kit — Profit Engine / Sol Mercer

Single source of truth for visual + copy identity. The engine already uses these everywhere.

## Identity
- **Brand:** Profit Engine
- **Persona / handle:** Sol Mercer · `@sol_mercer_io`
- **Tagline:** Signal, not noise.
- **Voice:** terse, signal-dense, no hype, "intelligence terminal" not hustle-bro.

## Colors
| Token | Hex | Use |
|---|---|---|
| Accent (signal green) | `#4fe08a` | logos, buttons, links, highlights |
| Background (near-black) | `#0a0c0b` | page/cover bg |
| Ink (warm off-white) | `#eae3d6` | body text on dark |
| Muted | `#9aa39a` | secondary text |

## Fonts (Google Fonts)
- Display: **Fraunces** (900/600)
- Body: **Newsreader**
- UI / data: **JetBrains Mono**

## Assets (in `output/assets/`)
| File | Size | Use |
|---|---|---|
| `stripe-icon.png` | 512² | **Stripe icon/logo**, favicon, app icon |
| `sol-mercer-avatar.png` | 1024² | X/social profile pic |
| `sol-mercer-banner.png` | 1500×500 | X header |
| `pack-cover.png` | 1280×720 | default product cover (Stripe + site) |
| `boost-sales-cover.png`, `gemini-cover.png` | 1280×720 | per-product covers |

Regenerate any from the parametric templates in `assets/*.html` (render in browser → screenshot).

## Stripe Dashboard — branding (one-time, ~3 min, YOU)
Account-level settings I can't reach via API. dashboard.stripe.com:

**Settings → Branding**
- Icon / Logo: upload `output/assets/stripe-icon.png`
- Brand color: `#4fe08a`
- Accent color: `#0a0c0b`

**Settings → Business → Public details**
- Public business name: `Profit Engine`
- Support email: `tablemountain963@gmail.com`
- Statement descriptor: `PROFITENGINE` (shows on buyer card statements)
- Support/website URL: `https://tablemountain963-gif.github.io/profit-engine/`

Applies to every checkout page + receipt automatically.

## Already customized (engine/code — automatic, current + future)
- **Checkout:** branded cover image, rich description (what's inside, format, lifetime, all-sales-final), promo codes, email capture, redirect-to-download.
- **Product pages:** "What You Get", Details block, all-sales-final + Terms link, buy button.
- **Legal:** /terms.html, /refund-policy.html, /privacy.html — all-sales-final, real contact email, footer-linked sitewide.
- **Site:** consistent dark editorial-terminal theme, green accent, fonts, internal links, free API, status page.
- **Social profile:** see `docs/X-PROFILE.md` (bio, pinned post, seed posts).

## Env that drives copy (set as GH secrets)
- `CONTACT_EMAIL` = tablemountain963@gmail.com (legal pages)
- `LEGAL_JURISDICTION` (optional, defaults "the United States") — set to your state for the Terms governing-law clause.
