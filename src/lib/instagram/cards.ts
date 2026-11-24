import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getConfiguredSiteUrl } from '@/lib/auth/site-url';
import { normalizeShopDomain } from '@/lib/shopify/normalize-shop';
import { getShopifyCatalogProductsForProductIds, type ShopifyCatalogProduct } from '@/lib/shopify/product-store';

type Button = { type: 'web_url'; url: string; title: string } | { type: 'postback'; title: string; payload: string };
export type Card = { title: string; subtitle?: string; image_url?: string; buttons: Button[] };
export type CardMessage = { attachment: { type: 'template'; payload: { template_type: 'generic'; elements: Card[] } } };

/** Shown in the inbox for messages that are cards, matching what the conversation sync stores. */
export const CARD_PLACEHOLDER = '[Attachment]';
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export function cardMessage(elements: Card[]): CardMessage {
  return { attachment: { type: 'template', payload: { template_type: 'generic', elements } } };
}

export function formatPrice(price: string, currency: string | null): string {
  const amount = Number(price);
  if (!Number.isFinite(amount)) return '';
  if (!currency) return String(amount);
  try { return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: amount % 1 === 0 ? 0 : 2 }).format(amount); } catch { return `${currency} ${amount}`; }
}

/** Ask Shopify's image CDN for a JPEG, since cards may not accept every stored format. */
export function cardImage(url: string | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return undefined;
    if (parsed.hostname === 'cdn.shopify.com') { parsed.searchParams.set('width', '1080'); parsed.searchParams.set('format', 'jpg'); }
    return parsed.toString();
  } catch { return undefined; }
}

export function productUrl(shopDomain: string, product: Pick<ShopifyCatalogProduct, 'handle' | 'shopify_variant_id'>): string | null {
  if (!product.handle) return null;
  const params = new URLSearchParams({ variant: String(product.shopify_variant_id), utm_source: 'instagram', utm_medium: 'comment_to_dm' });
  return `https://${shopDomain}/products/${encodeURIComponent(product.handle)}?${params}`;
}

/**
 * Current cards for the chosen products, with a tracked link each. Products that
 * are sold out, inactive or have no page are left out, so the list may be empty.
 */
export async function buildProductCards(admin: SupabaseClient, accountId: string, productIds: number[], replyId: string): Promise<Card[]> {
  const site = getConfiguredSiteUrl();
  if (!site || productIds.length === 0) return [];
  const { data: config, error: configError } = await admin.from('shopify_config').select('shop_domain').eq('account_id', accountId).limit(1).maybeSingle();
  if (configError) throw new Error(configError.message);
  const shop = config ? normalizeShopDomain(config.shop_domain) : null;
  if (!shop) return [];
  const products = await getShopifyCatalogProductsForProductIds({ db: admin, accountId, productIds });
  const items = products.flatMap((product) => {
    const url = productUrl(shop, product);
    return url ? [{ product, url, token: randomBytes(16).toString('base64url') }] : [];
  }).slice(0, 10);
  if (items.length === 0) return [];
  const { error } = await admin.from('instagram_comment_links').insert(items.map(({ url, token }) => ({ token, account_id: accountId, reply_id: replyId, url })));
  if (error) throw new Error(error.message);
  return items.map(({ product, token }) => ({
    title: clip(product.title, 80),
    subtitle: formatPrice(product.price, product.currency) || undefined,
    image_url: cardImage(product.image_url),
    buttons: [{ type: 'web_url', url: `${site}/l/${token}`, title: 'View product' }],
  }));
}

/** The first card in tap mode. The button text comes back as the customer's message, which is how a tap is recognised. */
export async function buildTapCard(admin: SupabaseClient, accountId: string, rule: { product_ids: number[]; tap_title: string; tap_subtitle: string; tap_button: string }): Promise<Card | null> {
  const products = await getShopifyCatalogProductsForProductIds({ db: admin, accountId, productIds: rule.product_ids });
  if (products.length === 0) return null;
  return {
    title: clip(rule.tap_title, 80),
    subtitle: rule.tap_subtitle ? clip(rule.tap_subtitle, 80) : undefined,
    image_url: cardImage(products.find((p) => p.image_url)?.image_url ?? null),
    buttons: [{ type: 'postback', title: rule.tap_button, payload: 'RA_VIEW_PRODUCTS' }],
  };
}
