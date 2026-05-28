// Package a generated product into an upload-ready buyer deliverable.
// Produces: 00-START-HERE.md, <Title>.md, <Title>.html (standalone, branded), LICENSE.txt
// Usage: node scripts/make-bundle.js <product-slug>
import { paths, readJson, readText, writeText, ensureDir, logger, slugify } from '../src/lib/util.js';
import { join } from 'node:path';
import { existsSync, copyFileSync, readdirSync } from 'node:fs';

function mdToHtml(md) {
  let s = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, l, c) => `<pre><code>${c.trim()}</code></pre>`);
  s = s.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>').replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>')
       .replace(/^####\s+(.*)$/gm, '<h4>$1</h4>').replace(/^###\s+(.*)$/gm, '<h3>$1</h3>')
       .replace(/^##\s+(.*)$/gm, '<h2>$1</h2>').replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/(^|\n)((?:\d+\.\s+.+\n?)+)/g, (full, pre, block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^\d+\.\s+/, '')).map(li => `<li>${li}</li>`).join('');
    return `${pre}<ol>${items}</ol>\n`;
  });
  s = s.replace(/(^|\n)((?:[-*]\s+.+\n?)+)/g, (full, pre, block) => {
    const items = block.trim().split(/\n/).map(l => l.replace(/^[-*]\s+/, '')).map(li => `<li>${li}</li>`).join('');
    return `${pre}<ul>${items}</ul>\n`;
  });
  s = s.replace(/^\s*---\s*$/gm, '<hr/>');
  s = s.split(/\n\n+/).map(b => {
    const t = b.trim();
    if (!t) return '';
    if (/^<(h[1-6]|ul|ol|pre|hr|blockquote)/.test(t)) return t;
    return `<p>${t.replace(/\n/g, ' ')}</p>`;
  }).join('\n\n');
  return s;
}

function standaloneHtml(title, bodyMd) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"/><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin/>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400..900&family=Newsreader:opsz,wght@6..72,400..600&family=JetBrains+Mono:wght@400;500;700&display=swap"/>
<style>
:root{--bg:#0a0c0b;--ink:#eae3d6;--fg:#d7d3c8;--dim:#9aa39a;--accent:#4fe08a;--hair:#232a26;--bg1:#0f1311}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font-family:'Newsreader',Georgia,serif;font-size:17px;line-height:1.7}
.wrap{max-width:760px;margin:0 auto;padding:64px 24px 96px}
h1{font-family:'Fraunces',serif;font-weight:900;font-size:clamp(34px,6vw,52px);line-height:1.05;letter-spacing:-.03em;color:var(--ink);margin:0 0 10px}
h2{font-family:'Fraunces',serif;font-weight:600;font-size:24px;color:var(--ink);margin:44px 0 6px;padding-top:22px;border-top:1px solid var(--hair)}
h3{font-family:'Fraunces',serif;font-weight:600;font-size:19px;color:var(--ink);margin:26px 0 4px}
p{margin:14px 0}strong{color:var(--ink)}
ol,ul{padding-left:0;list-style:none}
ol>li,ul>li{margin:14px 0;padding:16px 18px;background:var(--bg1);border:1px solid var(--hair);border-radius:4px;position:relative}
ol{counter-reset:p}ol>li{counter-increment:p;padding-left:54px}
ol>li::before{content:counter(p);position:absolute;left:16px;top:16px;font-family:'JetBrains Mono',monospace;font-size:13px;font-weight:700;color:var(--accent)}
code{font-family:'JetBrains Mono',monospace;background:#141917;color:#cfe9d6;padding:2px 6px;border-radius:3px;font-size:.86em}
hr{border:0;border-top:1px solid var(--hair);margin:32px 0}
.kick{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--accent);margin-bottom:18px}
.brand{font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--dim);letter-spacing:.1em;margin-top:56px;padding-top:20px;border-top:1px solid var(--hair)}
@media print{body{background:#fff;color:#111}h1,h2,h3{color:#000}ol>li,ul>li{background:#f6f6f4;border-color:#ddd}.kick,ol>li::before{color:#0a8a4a}code{background:#eee;color:#0a5}}
</style></head><body><div class="wrap">
<div class="kick">Profit Engine · Prompt Pack</div>
${mdToHtml(bodyMd)}
<div class="brand">© ${new Date().getFullYear()} Profit Engine · single-user license · free lifetime updates</div>
</div></body></html>`;
}

export function makeBundle(slug, displayTitle) {
  const src = join(paths.output, 'products', slug);
  if (!existsSync(src)) throw new Error(`product not found: ${slug}`);
  const meta = readJson(join(src, 'meta.json'), {});
  const title = displayTitle || meta.title || slug;
  const fileBase = slugify(title) || slug;

  const outDir = join(paths.output, 'bundles', slug);
  ensureDir(outDir);

  // main payload (prompts.md or first .md that isn't readme/start/meta)
  const mainFile = ['prompts.md', 'playbook.md', 'checklist.md', 'ebook.md'].find(f => existsSync(join(src, f)));
  const payload = mainFile ? readText(join(src, mainFile)) : '';

  // 1. start here
  const startSrc = join(src, '00-START-HERE.md');
  if (existsSync(startSrc)) copyFileSync(startSrc, join(outDir, '00-START-HERE.md'));

  // 2. clean markdown
  writeText(join(outDir, `${fileBase}.md`), payload);

  // 3. standalone HTML
  writeText(join(outDir, `${fileBase}.html`), standaloneHtml(title, payload));

  // 4. license
  if (existsSync(join(src, 'LICENSE.txt'))) copyFileSync(join(src, 'LICENSE.txt'), join(outDir, 'LICENSE.txt'));

  logger.ok(`bundle ready: ${outDir} (${readdirSync(outDir).join(', ')})`);
  return outDir;
}

if (process.argv[1]?.endsWith('make-bundle.js')) {
  const slug = process.argv[2];
  const title = process.argv[3];
  if (!slug) { logger.err('usage: node scripts/make-bundle.js <slug> [title]'); process.exit(1); }
  console.log(makeBundle(slug, title));
}
