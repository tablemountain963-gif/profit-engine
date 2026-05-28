// AI provider abstraction. Pluggable backends. Template fallback so engine runs without keys.
import { logger } from '../lib/util.js';

const PROVIDERS = {
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    keyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    keyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    keyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
  },
  cerebras: {
    url: 'https://api.cerebras.ai/v1/chat/completions',
    keyEnv: 'CEREBRAS_API_KEY',
    defaultModel: 'llama-3.3-70b',
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    keyEnv: 'ANTHROPIC_API_KEY',
    defaultModel: 'claude-haiku-4-5-20251001',
  },
};

function pickProvider() {
  for (const [name, p] of Object.entries(PROVIDERS)) {
    if (process.env[p.keyEnv]) return name;
  }
  return null;
}

async function callOpenAICompat(provider, messages, opts = {}) {
  const p = PROVIDERS[provider];
  const key = process.env[p.keyEnv];
  const body = {
    model: opts.model || p.defaultModel,
    messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens || 1500,
  };
  const r = await fetch(p.url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${provider} ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropic(messages, opts = {}) {
  const p = PROVIDERS.anthropic;
  const key = process.env[p.keyEnv];
  const sys = messages.find(m => m.role === 'system')?.content;
  const rest = messages.filter(m => m.role !== 'system');
  const body = {
    model: opts.model || p.defaultModel,
    max_tokens: opts.maxTokens || 1500,
    messages: rest,
    ...(sys ? { system: sys } : {}),
  };
  const r = await fetch(p.url, {
    method: 'POST',
    headers: {
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  return data.content?.[0]?.text || '';
}

// Public API.
// opts.topicHint — a clean human topic; used by the template fallback so it never
// echoes raw prompt instructions. opts.kind — 'article'|'product'|'digest'|'social'.
export async function complete(messages, opts = {}) {
  const provider = opts.provider || pickProvider();
  if (!provider) {
    logger.dbg('AI: no provider key, using template fallback');
    return { provider: 'template', text: templateFallback(messages, opts) };
  }
  try {
    const text = provider === 'anthropic'
      ? await callAnthropic(messages, opts)
      : await callOpenAICompat(provider, messages, opts);
    return { provider, text };
  } catch (e) {
    logger.warn(`AI provider ${provider} failed: ${e.message}`);
    return { provider: 'template', text: templateFallback(messages, opts) };
  }
}

// Template fallback: lets engine run without any AI key.
// Uses an explicit topicHint when provided so it never leaks prompt instructions.
function templateFallback(messages, opts = {}) {
  const userMsg = messages.filter(m => m.role === 'user').pop()?.content || '';
  const topic = (opts.topicHint && opts.topicHint.trim()) || extractTopic(userMsg);
  const kind = opts.kind || detectKind(userMsg);

  if (kind === 'article') return templateArticle(topic);
  if (kind === 'product') return templateProduct(topic);
  if (kind === 'digest') return templateDigest(topic);
  return `# ${topic}\n\nA practical overview of ${topic}. (Add GROQ_API_KEY for full AI-generated content.)`;
}

function detectKind(userMsg) {
  const lower = userMsg.toLowerCase();
  if (lower.includes('article') || lower.includes('blog')) return 'article';
  if (lower.includes('prompt pack') || lower.includes('starter kit') || lower.includes('checklist') || lower.includes('field guide') || lower.includes('ebook')) return 'product';
  if (lower.includes('digest') || lower.includes('summar')) return 'digest';
  return 'other';
}

// True if model output looks like leaked prompt instructions (fallback corruption guard).
export function looksCorrupt(text) {
  if (!text || text.length < 80) return true;
  return /produce a markdown document|containing exactly \d+|^#\s*(produce|write|generate|create) /i.test(text.slice(0, 200));
}

function templateArticle(topic) {
  return `# ${topic}: A Complete Guide

## Introduction

${topic} has become an essential consideration for anyone serious about their goals. In this guide, we cover the practical fundamentals, common pitfalls, and recommended next steps.

## Why ${topic} Matters

Understanding ${topic} pays off in three ways:
1. It saves you time by giving you a working mental model.
2. It saves you money by surfacing decisions before they become expensive.
3. It compounds — once you understand the fundamentals, every subsequent decision is easier.

## Getting Started

The fastest path forward is to focus on three things in order:

**Step 1 — Survey the landscape.** Identify the established options and what differentiates them. Don't try to be exhaustive; aim for the leading three.

**Step 2 — Pick a default.** Choose the option that fits 80% of common cases. Defaults reduce decision fatigue and free your attention for the cases that genuinely matter.

**Step 3 — Iterate.** Run with the default for a finite trial period. Capture what worked, what didn't, and adjust.

## Common Mistakes

The most expensive mistake is optimization without measurement. Spend the first cycles on basic instrumentation so subsequent decisions are grounded in data, not vibes.

## Practical Resources

Below are tools that the community consistently recommends for ${topic}. Each link is an affiliate link — buying through them costs you nothing extra and supports independent guides like this one.

- [Recommended starter resource](#affiliate-1)
- [Mid-tier upgrade option](#affiliate-2)
- [Power-user toolkit](#affiliate-3)

## Conclusion

${topic} rewards consistency over intensity. Pick a default, measure honestly, and iterate. Subscribe for new guides as they are published.
`;
}

function templateProduct(topic) {
  return `# ${topic} — Starter Pack

## What's Inside

A curated starter pack for anyone exploring ${topic}. Each item is hand-selected to remove friction and accelerate decision-making.

- 12-page strategy primer
- Decision checklist (printable)
- Reference template (copy/paste ready)
- Curated link library

## Who It's For

Builders, operators, and creators who need a fast-start playbook for ${topic} without sifting through generic content.

## Why It Works

Most material on ${topic} is either too theoretical to act on or too narrow to generalize. This pack splits the difference: enough structure to make decisions, enough flexibility to adapt to your context.
`;
}

function templateDigest(topic) {
  return `# Daily Signal Digest

## Top Movers
1. Topic detected in source feeds (placeholder).
2. Topic detected in source feeds (placeholder).
3. Topic detected in source feeds (placeholder).

## Why It Matters
Brief commentary on what changed and why it's worth watching.

## Action Items
- Skim the top mover details.
- Decide whether any opportunity warrants a deeper dive.
`;
}

function extractTopic(prompt) {
  let s = String(prompt);
  // Pull a quoted title if the instruction names one: titled "X"
  const titled = s.match(/titled\s+["“]([^"”]{3,80})["”]/i);
  if (titled) return titled[1].replace(/\s*prompt pack\s*$/i, '').trim();
  // Pull "about: X" or "for: X"
  const about = s.match(/\b(?:about|for|on)\s*:?\s*([A-Za-z0-9][^\n.!?]{2,70})/i);
  if (about) return about[1].trim();
  // Strip leading verb instruction, take first clause
  s = s.replace(/^[^a-z0-9]*(write|produce|create|generate|compose)[^:]*:?\s*/i, '').trim();
  const firstLine = (s.split('\n')[0] || 'the topic').replace(/^[^a-zA-Z0-9]+/, '');
  return firstLine.slice(0, 70).replace(/[.!?]+$/, '').trim() || 'the topic';
}

export function describeProviders() {
  return Object.fromEntries(
    Object.entries(PROVIDERS).map(([k, v]) => [k, { keyEnv: v.keyEnv, hasKey: !!process.env[v.keyEnv] }])
  );
}
