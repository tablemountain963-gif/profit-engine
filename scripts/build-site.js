// Static site builder. Renders generated markdown into HTML for GitHub Pages.
// Pure stdlib. Zero deps. Minimal markdown → HTML.
import { paths, readJson, readText, writeText, listFiles, ensureDir, logger, nowIso } from '../src/lib/util.js';
import { join, basename } from 'node:path';
import { readdirSync, statSync, existsSync } from 'node:fs';

const SITE = paths.public;
const ARTICLES_OUT = join(SITE, 'articles');
const DIGESTS_OUT = join(SITE, 'digests');
const PRODUCTS_OUT = join(SITE, 'products');
const SOCIAL_OUT = join(SITE, 'social');

const SITE_TITLE = 'Profit Engine';
const SITE_TAGLINE = 'Autonomous trends · curated picks · daily signals';
const SITE_DESC = 'AI-curated affiliate guides, trend digests, and digital starter packs. Updated automatically.';

export async function buildSite() {
  ensureDir(SITE);
  ensureDir(ARTICLES_OUT);
  ensureDir(DIGESTS_OUT);
  ensureDir(PRODUCTS_OUT);
  ensureDir(SOCIAL_OUT);

  const articles = readJson(join(paths.data, 'articles.json'), { items: [] }).items || [];
  const digests = readJson(join(paths.data, 'digests.json'), { items: [] }).items || [];
  const products = readJson(join(paths.data, 'products.json'), { items: [] }).items || [];
  const social = readJson(join(paths.data, 'social.json'), { items: [] }).items || [];

  // Render each article
  for (const a of articles) {
    const src = join(paths.output, a.file);
    if (!existsSync(src)) continue;
    const md = readText(src);
    const html = renderPage({
      title: a.title,
      desc: `${a.title} — ${a.keywords?.join(', ') || ''}`,
      body: mdToHtml(stripFrontMatter(md)),
      breadcrumb: 'Articles',
      breadcrumbHref: 'index.html',
      published: a.date,
      type: 'article',
    });
    writeText(join(ARTICLES_OUT, `${a.slug}.html`), html);
  }

  // Render each digest
  for (const d of digests) {
    const src = join(paths.output, d.file);
    if (!existsSync(src)) continue;
    const md = readText(src);
    const html = renderPage({
      title: `Daily Trend Digest — ${d.date}`,
      desc: `Trend digest for ${d.date}`,
      body: mdToHtml(stripFrontMatter(md)),
      breadcrumb: 'Digests',
      breadcrumbHref: 'digests.html',
      published: d.date,
      type: 'digest',
    });
    writeText(join(DIGESTS_OUT, `${d.date}.html`), html);
  }

  // Render each product sales page (sales/<slug>.md)
  const salesDir = join(paths.output, 'sales');
  if (existsSync(salesDir)) {
    for (const f of readdirSync(salesDir).filter(x => x.endsWith('.md'))) {
      const slug = f.replace(/\.md$/, '');
      const md = readText(join(salesDir, f));
      const html = renderPage({
        title: extractTitle(md) || slug,
        desc: `Product: ${slug}`,
        body: mdToHtml(stripFrontMatter(md)),
        breadcrumb: 'Products',
        breadcrumbHref: 'products.html',
        type: 'product',
      });
      writeText(join(PRODUCTS_OUT, `${slug}.html`), html);
    }
  }

  // Render social packs
  const socialSrc = join(paths.output, 'social');
  if (existsSync(socialSrc)) {
    for (const f of readdirSync(socialSrc).filter(x => x.endsWith('.md'))) {
      const slug = f.replace(/\.md$/, '');
      const md = readText(join(socialSrc, f));
      const html = renderPage({
        title: extractTitle(md) || slug,
        desc: `Social pack: ${slug}`,
        body: mdToHtml(stripFrontMatter(md)),
        breadcrumb: 'Social',
        breadcrumbHref: 'social.html',
        type: 'social',
      });
      writeText(join(SOCIAL_OUT, `${slug}.html`), html);
    }
  }

  // Indexes
  writeText(join(SITE, 'index.html'), homeIndex({ articles, digests, products }));
  writeText(join(SITE, 'articles.html'), listIndex('Articles', articles.map(a => ({
    title: a.title, href: `articles/${a.slug}.html`, date: a.date, meta: (a.keywords || []).slice(0, 3).join(' · ') || a.niche,
  }))));
  writeText(join(SITE, 'digests.html'), listIndex('Digests', digests.map(d => ({
    title: `Daily Trend Digest — ${d.date}`, href: `digests/${d.date}.html`, date: d.date, meta: 'daily',
  }))));
  writeText(join(SITE, 'products.html'), listIndex('Products', products.map(p => ({
    title: p.title, href: `products/${p.slug}.html`, date: p.generatedAt?.slice(0, 10) || '', meta: `$${p.price} · ${p.niche}`,
  }))));
  writeText(join(SITE, 'social.html'), listIndex('Social', social.map(s => ({
    title: s.topic, href: `social/${s.slug}.html`, date: s.date, meta: s.niche,
  }))));
  writeText(join(SITE, 'subscribe.html'), subscribePage());
  writeText(join(SITE, 'pricing.html'), pricingPage());
  writeText(join(SITE, 'about.html'), aboutPage());
  writeText(join(SITE, 'sitemap.xml'), sitemap({ articles, digests, products }));
  writeText(join(SITE, 'robots.txt'), 'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n');
  writeText(join(SITE, 'feed.xml'), rssFeed({ articles, digests }));
  writeText(join(SITE, 'style.css'), css());

  // Copy state snapshot for transparency
  writeText(join(SITE, 'engine-state.json'), JSON.stringify({
    builtAt: nowIso(),
    counts: {
      articles: articles.length,
      digests: digests.length,
      products: products.length,
      social: social.length,
    },
  }, null, 2));

  return `articles=${articles.length} digests=${digests.length} products=${products.length} social=${social.length}`;
}

// ─── Markdown → HTML (minimal) ───────────────────────────
function mdToHtml(md) {
  // Escape HTML first
  let s = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Code fences
  s = s.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, lang, code) => `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`);

  // Headings
  s = s.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>')
       .replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
       .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>')
       .replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
       .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>')
       .replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');

  // Bold / italic / inline code
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
       .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
       .replace(/`([^`\n]+)`/g, '<code>$1</code>');

  // Links and images
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" loading="lazy" />');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener">$1</a>');

  // Unordered lists
  s = s.replace(/(^|\n)((?:[-*]\s+.+\n?)+)/g, (full, pre, block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, '')).map(li => `<li>${li}</li>`).join('');
    return `${pre}<ul>${items}</ul>\n`;
  });

  // Ordered lists
  s = s.replace(/(^|\n)((?:\d+\.\s+.+\n?)+)/g, (full, pre, block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, '')).map(li => `<li>${li}</li>`).join('');
    return `${pre}<ol>${items}</ol>\n`;
  });

  // Blockquotes
  s = s.replace(/^>\s?(.*)$/gm, '<blockquote>$1</blockquote>');

  // Horizontal rule
  s = s.replace(/^\s*---\s*$/gm, '<hr/>');

  // Paragraphs (any leftover non-tag lines)
  s = s.split(/\n\n+/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|ol|pre|blockquote|hr|table|p|div|figure)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, ' ')}</p>`;
  }).join('\n\n');

  return s;
}

function stripFrontMatter(md) {
  if (md.startsWith('---')) {
    const end = md.indexOf('\n---', 3);
    if (end > 0) return md.slice(end + 4).trim();
  }
  return md;
}

function extractTitle(md) {
  const stripped = stripFrontMatter(md);
  const m = stripped.match(/^#\s+(.+)$/m);
  if (m) return m[1].trim();
  const fm = md.match(/^title:\s*"?([^"\n]+)"?/m);
  return fm ? fm[1] : null;
}

// ─── Page templates ──────────────────────────────────────
function renderPage({ title, desc, body, breadcrumb, breadcrumbHref, published, type }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${escapeHtml(title)} — ${SITE_TITLE}</title>
  <meta name="description" content="${escapeHtml(desc || SITE_DESC)}" />
  <meta property="og:title" content="${escapeHtml(title)}" />
  <meta property="og:description" content="${escapeHtml(desc || SITE_DESC)}" />
  <meta property="og:type" content="${type || 'article'}" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
${header()}
<main class="prose">
  ${breadcrumb ? `<p class="breadcrumb"><a href="/${breadcrumbHref}">${breadcrumb}</a></p>` : ''}
  ${published ? `<p class="meta">Published ${published}</p>` : ''}
  ${body}
  ${footerCta()}
</main>
${footer()}
</body>
</html>`;
}

function homeIndex({ articles, digests, products }) {
  const featuredArticles = (articles || []).slice(0, 6);
  const recentDigests = (digests || []).slice(0, 5);
  const featuredProducts = (products || []).slice(0, 4);

  const body = `
<section class="hero">
  <h1>${SITE_TITLE}</h1>
  <p class="tagline">${SITE_TAGLINE}</p>
  <p class="lead">Trend signals, hand-curated picks, and ready-to-ship digital packs — generated and published autonomously around the clock.</p>
  <p><a class="btn" href="/subscribe.html">Subscribe to the daily digest</a> · <a href="/products.html">Browse packs</a> · <a href="/api/signals.json">Free signals API</a></p>
</section>

<section>
  <h2>Latest articles</h2>
  ${featuredArticles.length ? `<ul class="cards">${featuredArticles.map(a => `
    <li class="card">
      <a href="/articles/${a.slug}.html"><strong>${escapeHtml(a.title)}</strong></a>
      <p class="meta">${a.date} · ${(a.keywords || []).slice(0, 3).join(' · ') || a.niche}</p>
    </li>`).join('')}</ul>` : '<p class="meta">First articles will be generated by the autonomous engine on its next run.</p>'}
  <p><a href="/articles.html">All articles →</a></p>
</section>

<section>
  <h2>Recent digests</h2>
  ${recentDigests.length ? `<ul class="cards">${recentDigests.map(d => `
    <li class="card">
      <a href="/digests/${d.date}.html"><strong>Daily Trend Digest — ${d.date}</strong></a>
      <p class="meta">${d.topItems || 0} signals</p>
    </li>`).join('')}</ul>` : '<p class="meta">Digests publish on the daily run.</p>'}
  <p><a href="/digests.html">All digests →</a></p>
</section>

<section>
  <h2>Digital starter packs</h2>
  ${featuredProducts.length ? `<ul class="cards">${featuredProducts.map(p => `
    <li class="card">
      <a href="/products/${p.slug}.html"><strong>${escapeHtml(p.title)}</strong></a>
      <p class="meta">$${p.price} · ${p.niche}</p>
    </li>`).join('')}</ul>` : '<p class="meta">Packs ship after the first product cycle.</p>'}
  <p><a href="/products.html">All packs →</a></p>
</section>
  `;

  return renderPage({
    title: `${SITE_TITLE} — ${SITE_TAGLINE}`,
    desc: SITE_DESC,
    body,
    type: 'website',
  });
}

function listIndex(label, items) {
  const body = `
<h1>${label}</h1>
<ul class="cards">
${items.map(it => `<li class="card"><a href="/${it.href}"><strong>${escapeHtml(it.title)}</strong></a><p class="meta">${it.date} · ${it.meta || ''}</p></li>`).join('\n')}
</ul>
${items.length === 0 ? '<p class="meta">No items yet — autonomous engine will populate this on next run.</p>' : ''}
`;
  return renderPage({ title: label, body, type: 'list' });
}

function subscribePage() {
  return renderPage({
    title: 'Subscribe',
    desc: 'Get the daily trend digest in your inbox.',
    body: `
<h1>Subscribe to the daily digest</h1>
<p>One curated email each morning: top movers, rising topics, and opportunity radar.</p>
<form action="https://formspree.io/f/YOUR_FORM_ID" method="POST" class="signup">
  <label>Email <input type="email" name="email" required placeholder="you@example.com" /></label>
  <button type="submit">Subscribe</button>
  <p class="meta">Free. Unsubscribe anytime. No spam.</p>
</form>
<p class="meta">Configure form delivery in <code>public/subscribe.html</code> — point to Formspree, ConvertKit, Buttondown, or your own webhook.</p>
`,
    type: 'website',
  });
}

function pricingPage() {
  return renderPage({
    title: 'Pricing',
    desc: 'Free signals API + Premium tier.',
    body: `
<h1>Pricing</h1>
<div class="pricing">
  <div class="tier">
    <h3>Free</h3>
    <p class="price">$0</p>
    <ul>
      <li>Top 10 daily signals</li>
      <li>Top 5 topic clusters</li>
      <li>Daily digest archive</li>
      <li>Public JSON API</li>
    </ul>
    <p><a class="btn" href="/api/signals.json">View free API</a></p>
  </div>
  <div class="tier featured">
    <h3>Premium</h3>
    <p class="price">$9 / month</p>
    <ul>
      <li>Top 50 signals with full scoring</li>
      <li>Full topic clusters with niche tags</li>
      <li>Opportunity radar with action recommendations</li>
      <li>Webhook delivery</li>
      <li>Historical archive</li>
    </ul>
    <p><a class="btn" href="mailto:hello@example.com?subject=Premium%20Signal%20Access">Get Premium</a></p>
  </div>
  <div class="tier">
    <h3>Sponsor</h3>
    <p class="price">Contact</p>
    <ul>
      <li>Sponsorship slot in digest</li>
      <li>Featured product placement</li>
      <li>Dedicated email send</li>
    </ul>
    <p><a class="btn" href="mailto:sponsor@example.com">Inquire</a></p>
  </div>
</div>
`,
    type: 'website',
  });
}

function aboutPage() {
  return renderPage({
    title: 'About',
    body: `
<h1>About</h1>
<p><strong>${SITE_TITLE}</strong> is an autonomous publishing engine. It scans dozens of public trend sources every few hours, ranks opportunities, generates value-first content and digital products, and publishes them here — no human in the loop.</p>
<p>The free signals API lives at <a href="/api/signals.json"><code>/api/signals.json</code></a>. The full premium feed is available at <a href="/pricing.html">Premium</a>.</p>
<p>Source code: this site is deployed from a public repository on GitHub. Each post is generated, scored, monetized, and pushed automatically.</p>
`,
    type: 'website',
  });
}

function header() {
  return `<header class="site-header">
  <a href="/" class="brand">${SITE_TITLE}</a>
  <nav>
    <a href="/articles.html">Articles</a>
    <a href="/digests.html">Digests</a>
    <a href="/products.html">Packs</a>
    <a href="/social.html">Social</a>
    <a href="/pricing.html">Pricing</a>
    <a href="/about.html">About</a>
  </nav>
</header>`;
}

function footer() {
  return `<footer class="site-footer">
  <p>© ${new Date().getFullYear()} ${SITE_TITLE}. <a href="/feed.xml">RSS</a> · <a href="/sitemap.xml">Sitemap</a> · <a href="/api/signals.json">API</a></p>
  <p class="meta">Generated autonomously. <a href="/about.html">How it works</a>.</p>
</footer>`;
}

function footerCta() {
  return `<aside class="cta">
  <p><strong>Subscribe.</strong> Daily digest in your inbox — free. <a class="btn" href="/subscribe.html">Subscribe</a></p>
</aside>`;
}

function sitemap({ articles, digests, products }) {
  const urls = [
    '/',
    '/articles.html',
    '/digests.html',
    '/products.html',
    '/social.html',
    '/subscribe.html',
    '/pricing.html',
    '/about.html',
    ...articles.map(a => `/articles/${a.slug}.html`),
    ...digests.map(d => `/digests/${d.date}.html`),
    ...products.map(p => `/products/${p.slug}.html`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `<url><loc>${u}</loc></url>`).join('\n')}
</urlset>`;
}

function rssFeed({ articles, digests }) {
  const items = [
    ...articles.slice(0, 30).map(a => ({ title: a.title, link: `/articles/${a.slug}.html`, date: a.date, desc: (a.keywords || []).join(' · ') })),
    ...digests.slice(0, 30).map(d => ({ title: `Daily Trend Digest — ${d.date}`, link: `/digests/${d.date}.html`, date: d.date, desc: 'Daily trend digest' })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 50);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${SITE_TITLE}</title>
<link>/</link>
<description>${SITE_DESC}</description>
${items.map(it => `<item><title>${escapeXml(it.title)}</title><link>${it.link}</link><pubDate>${it.date}</pubDate><description>${escapeXml(it.desc || '')}</description></item>`).join('\n')}
</channel></rss>`;
}

function css() {
  return `
:root { --fg:#1a1a1a; --bg:#fafafa; --muted:#6b7280; --link:#0066cc; --accent:#0a8a4a; --border:#e5e7eb; --card:#ffffff; }
* { box-sizing: border-box; }
body { font: 16px/1.6 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; color: var(--fg); background: var(--bg); margin: 0; }
a { color: var(--link); text-decoration: none; }
a:hover { text-decoration: underline; }
.site-header { display:flex; align-items:center; justify-content:space-between; max-width: 960px; margin: 0 auto; padding: 16px 20px; border-bottom: 1px solid var(--border); }
.brand { font-weight: 800; font-size: 18px; color: var(--fg); }
nav a { margin-left: 18px; color: var(--fg); font-size: 14px; }
main.prose { max-width: 760px; margin: 0 auto; padding: 28px 20px 60px; }
main.prose h1 { font-size: 32px; line-height:1.2; margin: 12px 0 18px; }
main.prose h2 { font-size: 22px; margin-top: 32px; border-top: 1px solid var(--border); padding-top: 20px; }
main.prose h3 { font-size: 18px; margin-top: 24px; }
main.prose p { margin: 12px 0; }
.meta { color: var(--muted); font-size: 14px; }
.breadcrumb { font-size: 14px; }
.hero { padding: 28px 0; }
.hero h1 { font-size: 36px; }
.tagline { font-size: 18px; color: var(--muted); }
.lead { font-size: 17px; }
.cards { list-style: none; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.card { background: var(--card); border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; }
.card strong { display: block; margin-bottom: 6px; }
.btn { display: inline-block; padding: 10px 16px; background: var(--accent); color: #fff; border-radius: 6px; }
.btn:hover { text-decoration: none; filter: brightness(0.95); }
.cta { margin-top: 36px; padding: 18px 20px; background: var(--card); border: 1px solid var(--border); border-radius: 8px; }
.signup label { display: block; margin: 12px 0; }
.signup input { width: 100%; padding: 10px; border: 1px solid var(--border); border-radius: 6px; }
.signup button { padding: 10px 16px; background: var(--accent); color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
.pricing { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; margin: 20px 0; }
.tier { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 20px; }
.tier.featured { border-color: var(--accent); box-shadow: 0 2px 8px rgba(10,138,74,.12); }
.tier .price { font-size: 28px; font-weight: 700; }
.tier ul { padding-left: 18px; }
pre { background: #f3f4f6; padding: 12px; border-radius: 6px; overflow-x: auto; font-size: 13px; }
code { background: #f3f4f6; padding: 2px 5px; border-radius: 3px; font-size: 0.92em; }
pre code { background: transparent; padding: 0; }
blockquote { margin: 12px 0; padding: 8px 16px; border-left: 4px solid var(--border); color: var(--muted); }
.site-footer { max-width: 960px; margin: 40px auto 0; padding: 22px 20px; border-top: 1px solid var(--border); color: var(--muted); font-size: 14px; }
.site-footer a { color: var(--muted); }
.ad-zone { margin: 24px 0; padding: 12px; border: 1px dashed var(--border); border-radius: 6px; min-height: 60px; text-align: center; color: var(--muted); font-size: 13px; }
@media (max-width:640px) { nav a { margin-left: 10px; font-size: 13px; } main.prose h1 { font-size: 26px; } }
`;
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeXml(s) { return escapeHtml(s); }

// CLI entry
if (process.argv[1]?.endsWith('build-site.js')) {
  buildSite().then(s => { logger.ok(`built: ${s}`); process.exit(0); }).catch(e => { logger.err(e.message); process.exit(1); });
}
