// Static site builder. Renders generated markdown into HTML for GitHub Pages.
// Pure stdlib. Zero deps. Minimal markdown → HTML.
import { paths, readJson, readText, writeText, listFiles, ensureDir, logger, nowIso } from '../src/lib/util.js';
import { siteBaseUrl, metaDescription, articleSchema, productSchema, websiteSchema, breadcrumbSchema, metaBlock, indexNowKeyFile, pingIndexNow } from '../src/engine/seo.js';
import { join, basename } from 'node:path';
import { readdirSync, statSync, existsSync, copyFileSync } from 'node:fs';

const SITE = paths.public;
const ARTICLES_OUT = join(SITE, 'articles');
const DIGESTS_OUT = join(SITE, 'digests');
const PRODUCTS_OUT = join(SITE, 'products');
const SOCIAL_OUT = join(SITE, 'social');

const SITE_TITLE = 'Profit Engine';
const SITE_TAGLINE = 'Autonomous trends · curated picks · daily signals';
const SITE_DESC = 'AI-curated affiliate guides, trend digests, and digital starter packs. Updated automatically.';

// GitHub Pages project sites serve from /<repo>, so root-absolute paths (/style.css)
// must be prefixed. User/org sites (user.github.io) and custom domains serve from root.
// Override with SITE_BASE_PATH env ('' for root).
function basePath() {
  if (process.env.SITE_BASE_PATH !== undefined) return process.env.SITE_BASE_PATH;
  const repo = process.env.GITHUB_REPOSITORY;
  if (repo && repo.includes('/')) {
    const name = repo.split('/')[1];
    if (name.toLowerCase().endsWith('.github.io')) return '';
    return '/' + name;
  }
  return '';
}

// Rewrite root-absolute href/src ("/x") to include the base path. Leaves
// protocol-relative ("//"), absolute (https://), anchors (#), and mailto untouched.
function applyBase(html) {
  const base = basePath();
  if (!base) return html;
  return html
    .replace(/(href|src)="\/(?!\/)/g, `$1="${base}/`)
    .replace(/url\(\/(?!\/)/g, `url(${base}/`);
}

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

  const base = siteBaseUrl();
  const newUrls = [];

  // Render each article (+ internal "Related" links for SEO + dwell time)
  for (const a of articles) {
    const src = join(paths.output, a.file);
    if (!existsSync(src)) continue;
    const md = readText(src);
    const stripped = stripFrontMatter(md);
    const desc = metaDescription(stripped, a.title);
    const url = `${base}/articles/${a.slug}.html`;
    newUrls.push(url);
    const schema = articleSchema({ title: a.title, description: desc, url, datePublished: a.date });
    const related = relatedArticles(a, articles);
    const relatedHtml = related.length
      ? `\n<h2>Related reading</h2>\n<ul class="cards">${related.map(r => `<li class="card"><a href="/articles/${r.slug}.html"><strong>${escapeHtml(r.title)}</strong></a><span class="meta">${r.niche || ''}</span></li>`).join('')}</ul>`
      : '';
    let bodyHtml = mdToHtml(stripped);
    // Ensure a visible H1 (the generator strips the AI's title heading). SEO + UX.
    if (!/<h1[\s>]/i.test(bodyHtml)) bodyHtml = `<h1>${escapeHtml(a.title)}</h1>\n` + bodyHtml;
    const html = renderPage({
      title: a.title,
      desc,
      body: bodyHtml + relatedHtml,
      breadcrumb: 'Articles',
      breadcrumbHref: 'articles.html',
      published: a.date,
      type: 'article',
      url,
      schema,
    });
    writeText(join(ARTICLES_OUT, `${a.slug}.html`), html);
  }

  // Render each digest
  for (const d of digests) {
    const src = join(paths.output, d.file);
    if (!existsSync(src)) continue;
    const md = readText(src);
    const stripped = stripFrontMatter(md);
    const desc = metaDescription(stripped, `Daily trend digest for ${d.date}`);
    const url = `${base}/digests/${d.date}.html`;
    newUrls.push(url);
    const schema = articleSchema({ title: `Daily Trend Digest — ${d.date}`, description: desc, url, datePublished: d.date });
    const html = renderPage({
      title: `Daily Trend Digest — ${d.date}`,
      desc,
      body: mdToHtml(stripped),
      breadcrumb: 'Digests',
      breadcrumbHref: 'digests.html',
      published: d.date,
      type: 'digest',
      url,
      schema,
    });
    writeText(join(DIGESTS_OUT, `${d.date}.html`), html);
  }

  // Buy-link map (slug -> { url, cover, platform }) for monetized products.
  const buyLinks = readJson(join(paths.data, 'buy-links.json'), {});

  // Render each product sales page (sales/<slug>.md)
  const salesDir = join(paths.output, 'sales');
  if (existsSync(salesDir)) {
    for (const f of readdirSync(salesDir).filter(x => x.endsWith('.md'))) {
      const slug = f.replace(/\.md$/, '');
      const md = readText(join(salesDir, f));
      const stripped = stripFrontMatter(md);
      const title = extractTitle(md) || slug;
      const desc = metaDescription(stripped, title);
      const url = `${base}/products/${slug}.html`;
      newUrls.push(url);
      const productInfo = products.find(p => p.slug === slug) || {};
      const buy = buyLinks[slug];
      const schema = productSchema({ title, description: desc, price: productInfo.price || 19, slug, image: buy?.cover ? `${base}${buy.cover}` : undefined });

      let bodyHtml = mdToHtml(stripped);
      // Inject real buy button: replace the placeholder anchor (#buy-<slug>) with the live URL.
      if (buy?.url) {
        const buyBtn = `<a class="btn buy" href="${buy.url}" rel="noopener" target="_blank">Buy now — $${productInfo.price || 19} →</a>`;
        bodyHtml = bodyHtml.replace(new RegExp(`<a href="#buy-${slug}"[^>]*>[^<]*</a>`, 'g'), buyBtn)
                           .replace(/<a href="#buy-[^"]*"[^>]*>([^<]*)<\/a>/g, buyBtn);
        // Prepend cover image + a top buy bar.
        const cover = buy.cover ? `<img class="product-cover" src="${buy.cover}" alt="${escapeHtml(title)}" />` : '';
        bodyHtml = `${cover}\n<p class="buybar">${buyBtn} <span class="secure">Secure checkout via ${buy.platform || 'Gumroad'}</span></p>\n` + bodyHtml;
      }

      const html = renderPage({
        title,
        desc,
        body: bodyHtml,
        breadcrumb: 'Products',
        breadcrumbHref: 'products.html',
        type: 'product',
        url,
        schema,
      });
      writeText(join(PRODUCTS_OUT, `${slug}.html`), html);
    }
  }

  // Copy generated assets (covers/thumbnails) into the published site.
  const assetsSrc = join(paths.output, 'assets');
  if (existsSync(assetsSrc)) {
    const assetsOut = join(SITE, 'assets');
    ensureDir(assetsOut);
    for (const f of readdirSync(assetsSrc)) {
      try { copyFileSync(join(assetsSrc, f), join(assetsOut, f)); } catch { /* skip */ }
    }
  }

  // Buyer delivery: copy bundles of SOLD (buy-link) products to /downloads/<slug>/,
  // with a per-pack index. Linked only from the post-purchase thank-you page.
  const buyLinks2 = readJson(join(paths.data, 'buy-links.json'), {});
  const bundlesSrc = join(paths.output, 'bundles');
  if (existsSync(bundlesSrc)) {
    for (const slug of Object.keys(buyLinks2)) {
      const bdir = join(bundlesSrc, slug);
      if (!existsSync(bdir)) continue;
      const outDir = join(SITE, 'downloads', slug);
      ensureDir(outDir);
      const files = readdirSync(bdir);
      for (const f of files) { try { copyFileSync(join(bdir, f), join(outDir, f)); } catch {} }
      const prod = products.find(p => p.slug === slug) || {};
      writeText(join(outDir, 'index.html'), downloadIndex(prod.title || slug, files));
    }
  }
  // Post-purchase landing — redirects to the buyer's download folder.
  writeText(join(SITE, 'thank-you.html'), thankYouPage());

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
  writeText(join(SITE, 'status.html'), statusPage({ articles, digests, products, social }));
  writeText(join(SITE, 'sitemap.xml'), sitemap({ articles, digests, products }));
  writeText(join(SITE, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /downloads/\nDisallow: /thank-you.html\nSitemap: ${siteBaseUrl()}/sitemap.xml\n`);
  writeText(join(SITE, 'feed.xml'), rssFeed({ articles, digests }));
  writeText(join(SITE, 'style.css'), css());

  // Public free-tier signals API — derived from persisted premium data so it
  // survives any deploy (including skip_generation rebuilds). public/ is ephemeral.
  ensureDir(join(SITE, 'api'));
  const premium = readJson(join(paths.data, 'signals-premium.json'), null);
  if (premium) {
    writeText(join(SITE, 'api', 'signals.json'), JSON.stringify({
      generatedAt: premium.generatedAt,
      tier: 'free',
      top: (premium.topItems || []).slice(0, 10),
      topics: (premium.topics || []).slice(0, 5),
    }, null, 2));
  }

  // IndexNow key file
  const keyFile = indexNowKeyFile();
  writeText(join(SITE, keyFile.name), keyFile.body);

  // OG default image (svg generated inline so we don't need a CDN)
  writeText(join(SITE, 'og-default.svg'), defaultOgImage());

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

  // Ping IndexNow with new URLs (Bing/Yandex). Non-blocking.
  if (newUrls.length > 0 && process.env.GITHUB_ACTIONS) {
    pingIndexNow(newUrls).catch(() => {});
  }

  return `articles=${articles.length} digests=${digests.length} products=${products.length} social=${social.length}`;
}

function defaultOgImage() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a8a4a"/>
      <stop offset="100%" stop-color="#055530"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <text x="80" y="280" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-weight="800" font-size="96" fill="#fff">Profit Engine</text>
  <text x="80" y="360" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="34" fill="rgba(255,255,255,.85)">Autonomous trends · curated picks · daily signals</text>
  <text x="80" y="560" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="22" fill="rgba(255,255,255,.7)">tablemountain963-gif.github.io/profit-engine</text>
</svg>`;
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
// Analytics opt-in via env var. User pastes their full snippet — they are
// responsible for adding integrity="sha384-..." crossorigin="anonymous" to any
// external <script> tag to prevent CDN compromise (Subresource Integrity).
// We deliberately do NOT inject external CDN scripts automatically.
function analyticsTag() {
  if (process.env.ANALYTICS_HEAD_SNIPPET) {
    return process.env.ANALYTICS_HEAD_SNIPPET;
  }
  return '';
}

function outboundTracker() {
  // Lightweight client-side outbound link tracker — pure JS, no remote calls.
  // Stores last 50 outbound clicks in localStorage and exposes them via console.
  return `<script>
(function(){
  document.addEventListener('click', function(e){
    var a = e.target.closest('a');
    if (!a) return;
    if (a.host && a.host !== location.host) {
      try {
        var key = 'profit_engine_clicks';
        var arr = JSON.parse(localStorage.getItem(key) || '[]');
        arr.unshift({ url: a.href, t: Date.now(), page: location.pathname });
        if (arr.length > 50) arr = arr.slice(0, 50);
        localStorage.setItem(key, JSON.stringify(arr));
      } catch(_){}
    }
  }, { passive: true });
})();
</script>`;
}

function fontLinks() {
  return `<link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400..900;1,9..144,400..900&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400..500&family=JetBrains+Mono:wght@400;500;700&display=swap" />`;
}

function renderPage({ title, desc, body, breadcrumb, breadcrumbHref, published, type, url, schema, layout = 'prose', hideCta = false }) {
  const seoMeta = url ? metaBlock({ title, description: desc || SITE_DESC, url, type, schema }) : '';
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="theme-color" content="#0a0c0b" />
  ${process.env.GOOGLE_SITE_VERIFICATION ? `<meta name="google-site-verification" content="${escapeHtml(process.env.GOOGLE_SITE_VERIFICATION)}" />` : ''}
  <title>${escapeHtml(title)} — ${SITE_TITLE}</title>
  ${seoMeta || `<meta name="description" content="${escapeHtml(desc || SITE_DESC)}" />`}
  <link rel="alternate" type="application/rss+xml" href="/feed.xml" />
  ${fontLinks()}
  <link rel="stylesheet" href="/style.css" />
  ${analyticsTag()}
</head>
<body>
${header()}
<main class="${layout}">
  ${breadcrumb ? `<p class="breadcrumb"><a href="/${breadcrumbHref}">← ${breadcrumb}</a></p>` : ''}
  ${published ? `<p class="meta">Published ${published}</p>` : ''}
  ${body}
  ${hideCta ? '' : footerCta()}
</main>
${footer()}
${outboundTracker()}
</body>
</html>`;
  return applyBase(html);
}

function homeIndex({ articles, digests, products }) {
  const featuredArticles = (articles || []).slice(0, 6);
  const recentDigests = (digests || []).slice(0, 3);
  const featuredProducts = (products || []).slice(0, 3);

  // Ticker data from latest signals.
  const signals = readJson(join(paths.data, 'signals-premium.json'), null);
  const tickerItems = (signals?.topItems || []).slice(0, 14).map(i => ({
    label: i.title.length > 52 ? i.title.slice(0, 52) + '…' : i.title,
    niche: i.niche,
    score: i.score,
  }));
  const tickerHtml = tickerItems.length
    ? `<div class="ticker"><div class="ticker-inner">${
        [...tickerItems, ...tickerItems].map(t =>
          `<span class="ticker-item"><span class="up">▲</span> <b>${escapeHtml(t.label)}</b> <span style="color:var(--fg-faint)">${t.niche}·${t.score}</span></span>`
        ).join('')
      }</div></div>`
    : '';

  const niches = [...new Set((signals?.topItems || []).map(i => i.niche))].slice(0, 5);

  const body = `
<section class="hero">
  <span class="kicker">Live · autonomous · updated every 4h</span>
  <h1>The web, <em>distilled</em> into signal.</h1>
  <p class="lead">An engine that reads ${30}+ sources around the clock, scores what's rising, and ships buying guides, daily digests, and ready-made packs — automatically.${niches.length ? ` Tracking <strong style="color:var(--fg)">${niches.join(', ')}</strong> right now.` : ''}</p>
  <div class="hero-actions">
    <a class="btn" href="/subscribe.html">Get the daily digest →</a>
    <a class="btn ghost" href="/api/signals.json">Free signals API</a>
  </div>
</section>
${tickerHtml}

<div class="sec-head"><h2>Latest intelligence</h2><a class="more" href="/articles.html">all articles →</a></div>
${featuredArticles.length ? `<ul class="feed">${featuredArticles.map(a => `
  <li class="card reveal">
    <span class="ctag">${(a.keywords || [a.niche])[0] || a.niche}</span>
    <a href="/articles/${a.slug}.html"><strong>${escapeHtml(a.title)}</strong></a>
    <span class="meta">${a.date}</span>
  </li>`).join('')}</ul>` : '<p class="meta">First articles generate on the next engine run.</p>'}

<div class="sec-head"><h2>Daily digests</h2><a class="more" href="/digests.html">archive →</a></div>
${recentDigests.length ? `<ul class="cards">${recentDigests.map(d => `
  <li class="card">
    <a href="/digests/${d.date}.html"><strong>Trend Digest — ${d.date}</strong></a>
    <span class="meta">${d.topItems || 0} signals ranked</span>
  </li>`).join('')}</ul>` : '<p class="meta">Digests publish daily.</p>'}

<div class="sec-head"><h2>Starter packs</h2><a class="more" href="/products.html">all packs →</a></div>
${featuredProducts.length ? `<ul class="cards">${featuredProducts.map(p => `
  <li class="card">
    <span class="ctag">${p.niche} · $${p.price}</span>
    <a href="/products/${p.slug}.html"><strong>${escapeHtml(p.title)}</strong></a>
  </li>`).join('')}</ul>` : '<p class="meta">Packs ship after the first product cycle.</p>'}
  `;

  return renderPage({
    title: `${SITE_TITLE} — ${SITE_TAGLINE}`,
    desc: SITE_DESC,
    body,
    type: 'website',
    url: siteBaseUrl() + '/',
    schema: websiteSchema(),
    layout: 'wide',
  });
}

function listIndex(label, items) {
  const body = `
<div class="sec-head"><h1>${label}</h1><span class="more">${items.length} published</span></div>
<ul class="cards">
${items.map(it => `<li class="card"><a href="/${it.href}"><strong>${escapeHtml(it.title)}</strong></a><span class="meta">${it.date}${it.meta ? ' · ' + it.meta : ''}</span></li>`).join('\n')}
</ul>
${items.length === 0 ? '<p class="meta">No items yet — autonomous engine will populate this on next run.</p>' : ''}
`;
  return renderPage({ title: label, body, type: 'list', layout: 'wide' });
}

function subscribePage() {
  const formId = process.env.FORMSPREE_FORM_ID || 'mzdwyopv';
  return renderPage({
    title: 'Subscribe',
    desc: 'Get the daily trend digest in your inbox — top movers, rising topics, opportunity radar.',
    hideCta: true,
    body: `
<span class="kicker" style="display:inline-flex;font-family:var(--mono);font-size:12.5px;letter-spacing:.22em;text-transform:uppercase;color:var(--accent);margin-bottom:18px;">The Daily Digest</span>
<h1>One email. Every morning.<br>Signal only.</h1>
<p>Top movers across AI, software, finance, and gear — ranked by the engine, summarized for a 30-second read. Plus the opportunity radar: what's rising before it's obvious.</p>
<aside class="cta" style="margin-top:32px;">
  <h3>Join the list</h3>
  <p>Free forever. The engine writes it; you skim it.</p>
  <form action="https://formspree.io/f/${formId}" method="POST" class="signup">
    <label><input type="email" name="email" required placeholder="you@domain.com" aria-label="Email" /></label>
    <input type="hidden" name="_subject" value="New Profit Engine subscriber" />
    <input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off" />
    <button type="submit">Subscribe →</button>
    <p class="meta">No spam. Unsubscribe anytime.</p>
  </form>
</aside>
<h2>What you get</h2>
<ul>
  <li><strong>Today in 30 seconds</strong> — three bullets, zero fluff.</li>
  <li><strong>Picks worth your click</strong> — ranked links with one-line context.</li>
  <li><strong>Topics rising</strong> — clusters gaining momentum across sources.</li>
  <li><strong>Opportunity radar</strong> — where the signal points next.</li>
</ul>
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
    layout: 'wide',
  });
}

function statusPage({ articles, digests, products, social }) {
  const state = readJson(join(paths.data, 'state.json'), { runs: 0, streams: {}, lastRun: null });
  const memory = readJson(join(paths.data, 'memory.json'), { topics: {}, niches: {} });

  const nichesByCount = Object.entries(memory.niches || {})
    .map(([k, v]) => ({ niche: k, count: v.count || 0, wins: v.wins || 0, losses: v.losses || 0 }))
    .sort((a, b) => b.count - a.count);

  const recentArticles = articles.slice(0, 8);
  const recentDigests = digests.slice(0, 5);
  const recentProducts = products.slice(0, 5);

  const lastByStream = state.streams || {};
  const streamRows = ['trend-signals', 'affiliate-content', 'digital-products', 'viral-factory'].map(name => {
    const s = lastByStream[name] || {};
    return `<tr><td>${name}</td><td>${s.totalRuns || 0}</td><td>${s.lastRunAt || '—'}</td><td>${s.lastResult || s.lastError || '—'}</td></tr>`;
  }).join('');

  const body = `
<h1>Engine Status</h1>
<p class="meta">Public transparency dashboard. Updated on every engine run.</p>

<h2>Cycle Summary</h2>
<table class="stats">
  <tr><th>Metric</th><th>Value</th></tr>
  <tr><td>Total runs</td><td>${state.runs || 0}</td></tr>
  <tr><td>Last run</td><td>${state.lastRun || '—'}</td></tr>
  <tr><td>Articles published</td><td>${articles.length}</td></tr>
  <tr><td>Daily digests</td><td>${digests.length}</td></tr>
  <tr><td>Digital products</td><td>${products.length}</td></tr>
  <tr><td>Social packs</td><td>${social.length}</td></tr>
</table>

<h2>Streams</h2>
<table class="stats">
  <tr><th>Stream</th><th>Runs</th><th>Last run</th><th>Last result</th></tr>
  ${streamRows}
</table>

<h2>Niche Activity</h2>
<table class="stats">
  <tr><th>Niche</th><th>Attempts</th><th>Wins</th><th>Losses</th></tr>
  ${nichesByCount.map(n => `<tr><td>${n.niche}</td><td>${n.count}</td><td>${n.wins}</td><td>${n.losses}</td></tr>`).join('') || '<tr><td colspan="4">No activity yet</td></tr>'}
</table>
<p class="meta">"Win" = a topic the engine published reappeared in fresh trends within 5 days (traction signal). "Loss" = no resurfacing in window. The engine biases future selection toward winning niches.</p>

<h2>Recent Activity</h2>
<h3>Articles</h3>
<ul>
  ${recentArticles.map(a => `<li><a href="/articles/${a.slug}.html">${escapeHtml(a.title)}</a> <span class="meta">— ${a.date}</span></li>`).join('') || '<li class="meta">None yet</li>'}
</ul>
<h3>Digests</h3>
<ul>
  ${recentDigests.map(d => `<li><a href="/digests/${d.date}.html">Daily Trend Digest — ${d.date}</a></li>`).join('') || '<li class="meta">None yet</li>'}
</ul>
<h3>Products</h3>
<ul>
  ${recentProducts.map(p => `<li><a href="/products/${p.slug}.html">${escapeHtml(p.title)}</a> <span class="meta">— $${p.price}</span></li>`).join('') || '<li class="meta">None yet</li>'}
</ul>

<h2>Live API</h2>
<p>Machine-readable feed: <a href="/api/signals.json"><code>/api/signals.json</code></a></p>
<p>Engine state snapshot: <a href="/engine-state.json"><code>/engine-state.json</code></a></p>
<p>RSS: <a href="/feed.xml"><code>/feed.xml</code></a></p>
`;

  return renderPage({
    title: 'Engine Status',
    desc: 'Live transparency dashboard for the Profit Engine autonomous publishing system.',
    body,
    type: 'website',
    url: siteBaseUrl() + '/status.html',
    layout: 'wide',
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
  <a href="/" class="brand"><span class="dot"></span>${SITE_TITLE}</a>
  <nav>
    <a href="/articles.html">articles</a>
    <a href="/digests.html">digests</a>
    <a href="/products.html">packs</a>
    <a href="/social.html">social</a>
    <a href="/pricing.html">pricing</a>
    <a href="/status.html">status</a>
    <a href="/about.html">about</a>
  </nav>
</header>`;
}

function footer() {
  const yr = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="footer-inner">
    <div>
      <div class="fbrand">${SITE_TITLE}</div>
      <p>An autonomous publishing engine. Scans the web every few hours, scores opportunities, and ships content, packs, and signals — no human in the loop.</p>
    </div>
    <div class="fcol">
      <h4>Read</h4>
      <a href="/articles.html">Articles</a>
      <a href="/digests.html">Daily Digests</a>
      <a href="/social.html">Social Packs</a>
    </div>
    <div class="fcol">
      <h4>Data &amp; Access</h4>
      <a href="/api/signals.json">Free Signals API</a>
      <a href="/pricing.html">Premium</a>
      <a href="/status.html">Engine Status</a>
      <a href="/feed.xml">RSS</a>
    </div>
  </div>
  <div class="footer-base">
    <span>© ${yr} ${SITE_TITLE} · generated autonomously</span>
    <span><a href="/sitemap.xml">sitemap</a> · <a href="/about.html">how it works</a></span>
  </div>
</footer>`;
}

function footerCta() {
  const formId = process.env.FORMSPREE_FORM_ID || 'mzdwyopv';
  return `<aside class="cta">
  <h3>Signal, not noise.</h3>
  <p>One curated email each morning — top movers, rising topics, and the opportunity radar. Free.</p>
  <form action="https://formspree.io/f/${formId}" method="POST" class="signup">
    <label><input type="email" name="email" required placeholder="you@domain.com" aria-label="Email" /></label>
    <input type="hidden" name="_subject" value="New Profit Engine subscriber" />
    <input type="text" name="_gotcha" style="display:none" tabindex="-1" autocomplete="off" />
    <button type="submit">Subscribe →</button>
    <p class="meta">No spam. Unsubscribe anytime.</p>
  </form>
</aside>`;
}

function sitemap({ articles, digests, products }) {
  const b = siteBaseUrl();
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
${urls.map(u => `<url><loc>${b}${u}</loc></url>`).join('\n')}
</urlset>`;
}

function rssFeed({ articles, digests }) {
  const b = siteBaseUrl();
  const items = [
    ...articles.slice(0, 30).map(a => ({ title: a.title, link: `${b}/articles/${a.slug}.html`, date: a.date, desc: (a.keywords || []).join(' · ') })),
    ...digests.slice(0, 30).map(d => ({ title: `Daily Trend Digest — ${d.date}`, link: `${b}/digests/${d.date}.html`, date: d.date, desc: 'Daily trend digest' })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 50);

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<title>${SITE_TITLE}</title>
<link>${b}/</link>
<description>${SITE_DESC}</description>
${items.map(it => `<item><title>${escapeXml(it.title)}</title><link>${it.link}</link><pubDate>${it.date}</pubDate><description>${escapeXml(it.desc || '')}</description></item>`).join('\n')}
</channel></rss>`;
}

function css() {
  return `
/* ============================================================
   PROFIT ENGINE — editorial intelligence terminal
   Display: Fraunces · Body: Newsreader · Data/UI: JetBrains Mono
   ============================================================ */
:root {
  --bg:        #0a0c0b;
  --bg-1:      #0f1311;
  --bg-2:      #141917;
  --bg-3:      #1a201d;
  --ink:       #eae3d6;
  --paper:     #ece7da;
  --fg:        #e7e3d8;
  --fg-dim:    #9aa39a;
  --fg-faint:  #5d655d;
  --accent:    #4fe08a;
  --accent-dk: #2fae63;
  --accent-gl: rgba(79,224,138,.14);
  --amber:     #f3b34a;
  --rose:      #ff7a6b;
  --line:      #20262300;
  --hair:      #232a26;
  --hair-2:    #2f3833;
  --radius:    3px;
  --maxw:      1080px;
  --read:      710px;
  --serif: 'Newsreader', Georgia, 'Times New Roman', serif;
  --display: 'Fraunces', Georgia, serif;
  --mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
}
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--serif);
  font-size: 18px;
  line-height: 1.7;
  color: var(--fg);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  position: relative;
  overflow-x: hidden;
}
/* atmospheric depth: faint top glow + grid + vignette */
body::before {
  content: "";
  position: fixed; inset: 0; z-index: -2;
  background:
    radial-gradient(120% 60% at 50% -10%, rgba(79,224,138,.07), transparent 60%),
    repeating-linear-gradient(0deg, transparent 0 39px, rgba(255,255,255,.014) 39px 40px),
    repeating-linear-gradient(90deg, transparent 0 39px, rgba(255,255,255,.014) 39px 40px);
  pointer-events: none;
}
body::after {
  content: "";
  position: fixed; inset: 0; z-index: -1;
  background: radial-gradient(130% 110% at 50% 30%, transparent 60%, rgba(0,0,0,.55));
  pointer-events: none;
}
a { color: var(--accent); text-decoration: none; transition: color .15s ease; }
a:hover { color: #8af0b4; }
::selection { background: var(--accent-gl); color: #fff; }

/* ── Header / terminal topbar ─────────────────────────── */
.site-header {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  gap: 18px;
  padding: 14px clamp(16px, 4vw, 40px);
  background: rgba(10,12,11,.72);
  backdrop-filter: blur(12px) saturate(140%);
  border-bottom: 1px solid var(--hair);
}
.brand {
  font-family: var(--display);
  font-weight: 900;
  font-size: 21px;
  letter-spacing: -.02em;
  color: var(--ink);
  display: inline-flex; align-items: center; gap: 9px;
}
.brand:hover { color: var(--ink); }
.brand .dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 0 var(--accent-gl);
  animation: pulse 2.4s infinite;
}
@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(79,224,138,.5); }
  70% { box-shadow: 0 0 0 9px rgba(79,224,138,0); }
  100% { box-shadow: 0 0 0 0 rgba(79,224,138,0); }
}
.site-header nav { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; }
.site-header nav a {
  font-family: var(--mono);
  font-size: 12.5px;
  letter-spacing: .02em;
  color: var(--fg-dim);
  padding: 6px 10px;
  border-radius: var(--radius);
  text-transform: lowercase;
}
.site-header nav a:hover { color: var(--ink); background: var(--bg-2); }

/* ── Layout containers ────────────────────────────────── */
main.prose { max-width: var(--read); margin: 0 auto; padding: 40px clamp(18px,4vw,24px) 80px; }
main.wide  { max-width: var(--maxw); margin: 0 auto; padding: 24px clamp(18px,4vw,40px) 80px; }

main.prose h1 { font-family: var(--display); font-weight: 600; font-size: clamp(30px, 5vw, 44px); line-height: 1.08; letter-spacing: -.02em; margin: 8px 0 20px; color: var(--ink); }
main.prose h2 { font-family: var(--display); font-weight: 600; font-size: 25px; letter-spacing: -.01em; margin: 44px 0 10px; padding-top: 22px; border-top: 1px solid var(--hair); color: var(--ink); }
main.prose h3 { font-family: var(--display); font-weight: 600; font-size: 20px; margin: 30px 0 8px; color: var(--ink); }
main.prose p { margin: 16px 0; color: var(--fg); }
main.prose ul, main.prose ol { padding-left: 22px; }
main.prose li { margin: 7px 0; }
main.prose > p:first-of-type::first-letter,
article > p:first-of-type::first-letter { /* drop cap on lead para */ }

.meta { color: var(--fg-faint); font-size: 13px; font-family: var(--mono); letter-spacing: .02em; }
.breadcrumb { font-family: var(--mono); font-size: 12.5px; text-transform: lowercase; margin-bottom: 4px; }
.breadcrumb a { color: var(--fg-dim); }

/* ── Hero ─────────────────────────────────────────────── */
.hero { padding: clamp(40px, 9vw, 96px) 0 36px; position: relative; }
.hero .kicker {
  font-family: var(--mono); font-size: 12.5px; letter-spacing: .22em;
  text-transform: uppercase; color: var(--accent);
  display: inline-flex; align-items: center; gap: 9px; margin-bottom: 22px;
}
.hero .kicker::before { content: ""; width: 26px; height: 1px; background: var(--accent); display: inline-block; }
.hero h1 {
  font-family: var(--display);
  font-weight: 900;
  font-size: clamp(42px, 8.5vw, 92px);
  line-height: .96;
  letter-spacing: -.035em;
  margin: 0 0 22px;
  color: var(--ink);
  max-width: 16ch;
}
.hero h1 em { font-style: italic; color: var(--accent); font-weight: 400; }
.hero .lead {
  font-size: clamp(18px, 2.4vw, 22px);
  line-height: 1.5;
  color: var(--fg-dim);
  max-width: 56ch;
  margin: 0 0 32px;
}
.hero-actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }

/* ── Ticker ───────────────────────────────────────────── */
.ticker {
  border-top: 1px solid var(--hair);
  border-bottom: 1px solid var(--hair);
  background: var(--bg-1);
  overflow: hidden; white-space: nowrap;
  margin: 40px 0 0;
}
.ticker-inner { display: inline-flex; gap: 0; padding: 11px 0; animation: ticker 48s linear infinite; }
.ticker:hover .ticker-inner { animation-play-state: paused; }
.ticker-item { font-family: var(--mono); font-size: 13px; color: var(--fg-dim); padding: 0 22px; border-right: 1px solid var(--hair); display: inline-flex; align-items: center; gap: 8px; }
.ticker-item b { color: var(--ink); font-weight: 500; }
.ticker-item .up { color: var(--accent); }
@keyframes ticker { from { transform: translateX(0); } to { transform: translateX(-50%); } }

/* ── Section headings (wide) ──────────────────────────── */
.sec-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 64px 0 22px; padding-bottom: 12px; border-bottom: 1px solid var(--hair); }
.sec-head h2 { font-family: var(--display); font-weight: 600; font-size: 28px; letter-spacing: -.01em; margin: 0; color: var(--ink); }
.sec-head .more { font-family: var(--mono); font-size: 12.5px; text-transform: lowercase; color: var(--fg-dim); }
.sec-head .more:hover { color: var(--accent); }

/* ── Feed / cards ─────────────────────────────────────── */
.feed { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(290px, 1fr)); gap: 1px; background: var(--hair); border: 1px solid var(--hair); border-radius: var(--radius); overflow: hidden; }
.feed .card { background: var(--bg-1); border: 0; border-radius: 0; padding: 22px 22px 20px; transition: background .18s ease, transform .18s ease; position: relative; }
.feed .card:hover { background: var(--bg-2); }
.feed .card::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px; background: var(--accent); transform: scaleY(0); transform-origin: top; transition: transform .2s ease; }
.feed .card:hover::before { transform: scaleY(1); }
.card .ctag { font-family: var(--mono); font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin-bottom: 11px; display: block; }
.card h3, .card strong { font-family: var(--display); font-weight: 600; font-size: 19px; line-height: 1.25; letter-spacing: -.01em; display: block; margin: 0 0 12px; color: var(--ink); }
.card a { color: var(--ink); }
.card a:hover { color: var(--accent); }
.card .meta { display: block; margin-top: 10px; }

/* simple cards grid (lists) */
.cards { list-style: none; padding: 0; margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }
.cards .card { background: var(--bg-1); border: 1px solid var(--hair); border-radius: var(--radius); padding: 20px; transition: border-color .18s ease, transform .18s ease; }
.cards .card:hover { border-color: var(--hair-2); transform: translateY(-2px); }
.cards .card strong { font-family: var(--display); font-weight: 600; font-size: 18px; line-height: 1.25; display: block; margin-bottom: 8px; color: var(--ink); }

/* ── Buttons ──────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  font-family: var(--mono); font-size: 13.5px; letter-spacing: .01em;
  padding: 12px 20px; border-radius: var(--radius);
  background: var(--accent); color: #07140c; font-weight: 700;
  border: 1px solid var(--accent);
  transition: transform .15s ease, box-shadow .15s ease, background .15s ease;
}
.btn:hover { color: #07140c; background: #6cf0a2; transform: translateY(-1px); box-shadow: 0 8px 24px -8px var(--accent-gl); }
.btn.ghost { background: transparent; color: var(--ink); border-color: var(--hair-2); }
.btn.ghost:hover { background: var(--bg-2); border-color: var(--accent); color: var(--accent); }

/* ── Inline subscribe (footer CTA) ────────────────────── */
.cta { margin: 72px 0 0; padding: 40px clamp(22px,4vw,44px); background: linear-gradient(135deg, var(--bg-2), var(--bg-1)); border: 1px solid var(--hair); border-radius: var(--radius); position: relative; overflow: hidden; }
.cta::after { content: ""; position: absolute; right: -60px; top: -60px; width: 200px; height: 200px; background: radial-gradient(circle, var(--accent-gl), transparent 70%); pointer-events: none; }
.cta h3 { font-family: var(--display); font-weight: 600; font-size: 26px; margin: 0 0 6px; color: var(--ink); }
.cta p { color: var(--fg-dim); margin: 0 0 20px; font-size: 16px; }
.signup { display: flex; gap: 10px; flex-wrap: wrap; max-width: 460px; }
.signup label { flex: 1 1 220px; }
.signup input[type=email] { width: 100%; padding: 13px 15px; border: 1px solid var(--hair-2); background: var(--bg); color: var(--ink); border-radius: var(--radius); font-family: var(--mono); font-size: 14px; }
.signup input[type=email]:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-gl); }
.signup button { padding: 13px 22px; background: var(--accent); color: #07140c; border: 0; border-radius: var(--radius); cursor: pointer; font-family: var(--mono); font-weight: 700; font-size: 13.5px; transition: background .15s ease; }
.signup button:hover { background: #6cf0a2; }
.signup .meta { flex-basis: 100%; margin-top: 4px; }

/* ── Pricing ──────────────────────────────────────────── */
.pricing { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; margin: 28px 0; }
.tier { background: var(--bg-1); border: 1px solid var(--hair); border-radius: var(--radius); padding: 28px 24px; display: flex; flex-direction: column; }
.tier h3 { font-family: var(--mono); font-size: 13px; letter-spacing: .14em; text-transform: uppercase; color: var(--fg-dim); margin: 0 0 14px; }
.tier.featured { border-color: var(--accent); box-shadow: 0 0 40px -16px var(--accent-gl); }
.tier.featured h3 { color: var(--accent); }
.tier .price { font-family: var(--display); font-size: 40px; font-weight: 600; color: var(--ink); margin: 0 0 16px; letter-spacing: -.02em; }
.tier ul { list-style: none; padding: 0; margin: 0 0 22px; flex: 1; }
.tier li { padding: 8px 0 8px 22px; position: relative; color: var(--fg); font-size: 15.5px; border-bottom: 1px solid var(--hair); }
.tier li::before { content: "→"; position: absolute; left: 0; color: var(--accent); font-family: var(--mono); }

/* ── Article prose niceties ───────────────────────────── */
article.body, main.prose article { }
main.prose blockquote { margin: 22px 0; padding: 4px 0 4px 22px; border-left: 2px solid var(--accent); color: var(--fg-dim); font-style: italic; font-size: 17px; }
main.prose hr { border: 0; border-top: 1px solid var(--hair); margin: 36px 0; }
main.prose a { border-bottom: 1px solid var(--accent-gl); }
main.prose a:hover { border-bottom-color: var(--accent); }
pre { background: var(--bg-1); border: 1px solid var(--hair); padding: 16px; border-radius: var(--radius); overflow-x: auto; font-size: 13.5px; }
code { font-family: var(--mono); background: var(--bg-2); padding: 2px 6px; border-radius: var(--radius); font-size: .86em; color: #cfe9d6; }
pre code { background: transparent; padding: 0; color: var(--fg); }

/* ── Tables (status) ──────────────────────────────────── */
table.stats { width: 100%; border-collapse: collapse; margin: 14px 0 30px; font-family: var(--mono); font-size: 13px; }
table.stats th, table.stats td { padding: 11px 12px; border-bottom: 1px solid var(--hair); text-align: left; }
table.stats th { color: var(--fg-dim); text-transform: uppercase; letter-spacing: .08em; font-size: 11px; font-weight: 500; }
table.stats td { color: var(--fg); }
table.stats td:nth-child(n+2) { font-variant-numeric: tabular-nums; }
table.stats tr:hover td { background: var(--bg-1); }

/* ── Product page ─────────────────────────────────────── */
.product-cover { width: 100%; height: auto; border: 1px solid var(--hair); border-radius: var(--radius); margin: 8px 0 20px; display: block; }
.buybar { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; margin: 0 0 28px; padding: 18px 20px; background: var(--bg-1); border: 1px solid var(--hair); border-radius: var(--radius); }
.btn.buy { font-size: 15px; padding: 14px 26px; }
.buybar .secure { font-family: var(--mono); font-size: 12px; color: var(--fg-faint); }

/* ── Ad zone ──────────────────────────────────────────── */
.ad-zone { margin: 30px 0; padding: 16px; border: 1px dashed var(--hair-2); border-radius: var(--radius); min-height: 60px; text-align: center; color: var(--fg-faint); font-family: var(--mono); font-size: 12px; }

/* ── Footer ───────────────────────────────────────────── */
.site-footer { border-top: 1px solid var(--hair); margin-top: 80px; background: var(--bg-1); }
.footer-inner { max-width: var(--maxw); margin: 0 auto; padding: 48px clamp(18px,4vw,40px); display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 40px; }
.footer-inner .fbrand { font-family: var(--display); font-weight: 900; font-size: 22px; color: var(--ink); }
.footer-inner p { color: var(--fg-faint); font-size: 14px; margin: 12px 0 0; max-width: 36ch; }
.fcol h4 { font-family: var(--mono); font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--fg-dim); margin: 0 0 14px; }
.fcol a { display: block; color: var(--fg-dim); font-size: 14px; padding: 5px 0; }
.fcol a:hover { color: var(--accent); }
.footer-base { border-top: 1px solid var(--hair); padding: 18px clamp(18px,4vw,40px); max-width: var(--maxw); margin: 0 auto; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; }
.footer-base, .footer-base a { font-family: var(--mono); font-size: 12px; color: var(--fg-faint); }
.footer-base a:hover { color: var(--accent); }

/* ── Load reveal ──────────────────────────────────────── */
@media (prefers-reduced-motion: no-preference) {
  .reveal { opacity: 0; transform: translateY(14px); animation: rise .7s cubic-bezier(.2,.7,.2,1) forwards; }
  .reveal:nth-child(2){ animation-delay:.06s } .reveal:nth-child(3){ animation-delay:.12s }
  .reveal:nth-child(4){ animation-delay:.18s } .reveal:nth-child(5){ animation-delay:.24s }
  .reveal:nth-child(6){ animation-delay:.3s }
  @keyframes rise { to { opacity: 1; transform: none; } }
}

/* ── Responsive ───────────────────────────────────────── */
@media (max-width: 760px) {
  body { font-size: 17px; }
  .site-header { flex-direction: column; align-items: flex-start; gap: 10px; }
  .footer-inner { grid-template-columns: 1fr 1fr; gap: 28px; }
}
@media (max-width: 480px) {
  .footer-inner { grid-template-columns: 1fr; }
  .hero h1 { font-size: clamp(38px, 13vw, 56px); }
}
`;
}

// Per-pack download index (linked only post-purchase). noindex.
function downloadIndex(title, files) {
  const links = files.filter(f => f !== 'index.html')
    .map(f => `<li><a href="${encodeURIComponent(f)}" download>${escapeHtml(f)}</a></li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Download — ${escapeHtml(title)}</title><link rel="stylesheet" href="/style.css"/></head>
<body><main class="prose"><h1>Thanks — here's your download</h1>
<p class="meta">${escapeHtml(title)}</p>
<p>Open <strong>00-START-HERE</strong> first, then the pack files:</p>
<ul>${links}</ul>
<p class="meta">Lifetime access. Lost this page? Reply to your Stripe receipt and we'll resend.</p>
</main></body></html>`;
}

// Post-purchase landing: ?p=<slug> → redirect to that pack's download folder.
function thankYouPage() {
  const base = siteBaseUrl();
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="robots" content="noindex,nofollow"/>
<title>Thank you — Profit Engine</title><link rel="stylesheet" href="/style.css"/></head>
<body><main class="prose"><h1>Payment received — thank you</h1>
<p id="msg">Preparing your download…</p>
<p><a id="dl" class="btn" href="/">Continue</a></p>
<script>
var p=new URLSearchParams(location.search).get('p');
if(p && /^[a-z0-9-]+$/.test(p)){var u='${base}/downloads/'+p+'/';document.getElementById('dl').href=u;document.getElementById('msg').textContent='Your files are ready.';location.replace(u);}
else{document.getElementById('msg').textContent='Check your Stripe receipt email for your download link.';}
</script></main></body></html>`;
}

// Pick up to 3 related articles: same niche first, then most recent. Excludes self.
function relatedArticles(article, all, n = 3) {
  const others = all.filter(x => x.slug !== article.slug);
  const sameNiche = others.filter(x => x.niche && x.niche === article.niche);
  const rest = others.filter(x => !sameNiche.includes(x));
  return [...sameNiche, ...rest].slice(0, n);
}

function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function escapeXml(s) { return escapeHtml(s); }

// CLI entry
if (process.argv[1]?.endsWith('build-site.js')) {
  buildSite().then(s => { logger.ok(`built: ${s}`); process.exit(0); }).catch(e => { logger.err(e.message); process.exit(1); });
}
