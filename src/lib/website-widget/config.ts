import type { SupabaseClient } from '@supabase/supabase-js';
import { buildProductCardUrl } from '@/lib/shopify/product-checkout-url';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import { formatShopifyProductPrice } from '@/lib/shopify/send-product-card';
import type { ChatMessage } from '@/lib/ai/types';

export const WIDGET_MAX_TURNS = 20;
export const WIDGET_MAX_MESSAGE_CHARS = 1000;
/** Earlier agent replies can be longer than anything a visitor may type. */
const WIDGET_MAX_ASSISTANT_CHARS = 4500;
const WIDGET_MAX_SEEN_VARIANTS = 40;
export const WIDGET_MAX_DOMAINS = 20;

export interface WidgetConfigRow {
  account_id: string;
  public_key: string;
  enabled: boolean;
  allowed_domains: string[];
  title: string;
  greeting: string;
  accent_color: string;
  whatsapp_number: string | null;
  daily_reply_limit: number;
}

const WIDGET_COLUMNS =
  'account_id, public_key, enabled, allowed_domains, title, greeting, accent_color, whatsapp_number, daily_reply_limit';

/** An enabled widget by its public key, or null. Never distinguishes why. */
export async function loadEnabledWidget(
  db: SupabaseClient,
  key: string | null
): Promise<WidgetConfigRow | null> {
  if (!key || !/^wgt_[0-9a-f]{32}$/.test(key)) return null;
  const { data, error } = await db
    .from('website_widget_config')
    .select(WIDGET_COLUMNS)
    .eq('public_key', key)
    .eq('enabled', true)
    .maybeSingle<WidgetConfigRow>();
  if (error) {
    console.error('[website widget] config lookup failed:', error);
    return null;
  }
  return data;
}

/**
 * Reduce what a merchant pastes ("https://www.Store.com/pages/x") to a bare
 * lowercase hostname. Returns null for anything that is not a real hostname;
 * wildcards are rejected so one entry can't open up a shared parent domain.
 */
export function normalizeWidgetDomain(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.includes('*')) return null;
  let host: string;
  try {
    host = new URL(
      /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`
    ).hostname;
  } catch {
    return null;
  }
  if (host === 'localhost') return host;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)
    ? host
    : null;
}

const withoutWww = (host: string) => host.replace(/^www\./, '');

/**
 * Exact host match, treating `www.` as the same site. Subdomains are not
 * included. HTTPS only, except localhost for testing a theme locally.
 *
 * This keeps the widget off other people's sites in a browser, but a script
 * can forge `Origin`, so the reply limits are what actually bound spend.
 */
export function isOriginAllowed(
  origin: string | null,
  allowedDomains: readonly string[]
): boolean {
  if (!origin) return false;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  const isLocalhost = url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(isLocalhost && url.protocol === 'http:'))
    return false;
  return allowedDomains.some(
    (domain) => withoutWww(domain) === withoutWww(url.hostname)
  );
}

/**
 * Validate the transcript a visitor's browser sends. It is untrusted: limit
 * its size, keep only known fields, and require it to end on a visitor turn.
 * Returns null when it can't be used.
 */
export function parseWidgetMessages(raw: unknown): ChatMessage[] | null {
  if (!Array.isArray(raw)) return null;
  const messages: ChatMessage[] = [];
  for (const entry of raw.slice(-WIDGET_MAX_TURNS)) {
    if (!entry || typeof entry !== 'object') return null;
    const { role, content, productVariantIds } = entry as Record<string, unknown>;
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string')
      return null;
    const text = content.trim();
    const max =
      role === 'user' ? WIDGET_MAX_MESSAGE_CHARS : WIDGET_MAX_ASSISTANT_CHARS;
    if (!text || text.length > max) return null;
    const seen =
      role === 'assistant' && Array.isArray(productVariantIds)
        ? productVariantIds
            .filter((id): id is number => Number.isSafeInteger(id) && id > 0)
            .slice(0, WIDGET_MAX_SEEN_VARIANTS)
        : [];
    messages.push({
      role,
      content: text,
      ...(seen.length ? { productVariantIds: seen } : {}),
    });
  }
  return messages.at(-1)?.role === 'user' ? messages : null;
}

/** wa.me link carrying the visitor's question, so they needn't retype it. */
export function buildWhatsAppUrl(
  number: string | null,
  question?: string
): string | null {
  if (!number) return null;
  const text = question?.trim()
    ? `Hi, I was chatting on your website: ${question.trim().slice(0, 300)}`
    : 'Hi, I have a question from your website.';
  return `https://wa.me/${number}?text=${encodeURIComponent(text)}`;
}

/** The handoff line for this channel. The brand's WhatsApp handoff message
 *  promises a reply "here", which this chat can't deliver. */
export function widgetHandoffText(
  agentText: string,
  whatsappUrl: string | null
): string {
  const closing = whatsappUrl
    ? 'Our team can take it from here on WhatsApp.'
    : 'Please contact the store directly and our team will help you.';
  const text = agentText.trim();
  return text ? `${text}\n\n${closing}` : closing;
}

export interface WidgetProduct {
  variant_id: number;
  title: string;
  variant_title: string | null;
  price: string;
  image_url: string | null;
  url: string;
}

/** Product cards for the widget, with links attributed to this channel. */
export function toWidgetProducts(
  products: ShopifyCatalogProduct[],
  shopDomain: string
): WidgetProduct[] {
  return products.slice(0, 4).map((product) => {
    const url = new URL(
      buildProductCardUrl({
        linkTarget: 'product_page',
        shopDomain,
        variantId: product.shopify_variant_id,
        handle: product.handle,
      })
    );
    if (url.searchParams.has('utm_source')) {
      url.searchParams.set('utm_source', 'website_widget');
    }
    return {
      variant_id: product.shopify_variant_id,
      title: product.title,
      variant_title:
        product.variant_title?.toLowerCase() === 'default title'
          ? null
          : product.variant_title,
      price: formatShopifyProductPrice(product.price, product.currency),
      image_url: product.image_url,
      url: url.toString(),
    };
  });
}

/** CORS for a verified origin. Credentials are never allowed. */
export function widgetCorsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

/** Best-effort visitor IP, for per-visitor rate limits only. */
export function widgetClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return request.headers.get('x-real-ip')?.trim() || 'unknown';
}
