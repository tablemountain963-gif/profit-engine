// Stripe auto-lister. Creates Product + Price + Payment Link per digital pack via
// the Stripe API (form-encoded, Bearer key). Pure Node, no deps.
//
// Required env:
//   STRIPE_API_KEY   restricted key with write on Products, Prices, Payment Links
// Uses a restricted key — cannot touch payouts/charges/customers.
import { logger } from '../../lib/util.js';
import { siteBaseUrl } from '../seo.js';

const API = 'https://api.stripe.com/v1';

export function hasStripeCreds() {
  return !!process.env.STRIPE_API_KEY;
}

// Flatten nested objects/arrays into Stripe's bracket form encoding.
function toForm(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === 'object') toForm(item, `${key}[${i}]`, out);
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
      });
    } else if (v && typeof v === 'object') {
      toForm(v, key, out);
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
    }
  }
  return out;
}

async function api(path, params) {
  const r = await fetch(`${API}/${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.STRIPE_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: toForm(params).join('&'),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`stripe ${path} ${r.status}: ${data?.error?.message || JSON.stringify(data)}`);
  return data;
}

// Create Product → Price → Payment Link. Returns { url, productId, priceId }.
// After payment, Stripe redirects to the on-site download page for this slug.
export async function createPaymentLink({ name, description, priceUsd, slug, image }) {
  if (!hasStripeCreds()) throw new Error('Stripe creds not set');
  const base = siteBaseUrl();

  const product = await api('products', {
    name: name.slice(0, 250),
    description: (description || '').slice(0, 500) || undefined,
    images: image ? [image.startsWith('http') ? image : `${base}${image}`] : undefined,
    metadata: { slug },
  });

  const price = await api('prices', {
    product: product.id,
    unit_amount: Math.round((priceUsd || 19) * 100),
    currency: 'usd',
  });

  const link = await api('payment_links', {
    line_items: [{ price: price.id, quantity: 1 }],
    after_completion: {
      type: 'redirect',
      redirect: { url: `${base}/thank-you.html?p=${encodeURIComponent(slug)}` },
    },
    metadata: { slug },
    allow_promotion_codes: true,
  });

  return { url: link.url, productId: product.id, priceId: price.id };
}

export function describeStripeStatus() {
  return { configured: hasStripeCreds() };
}
