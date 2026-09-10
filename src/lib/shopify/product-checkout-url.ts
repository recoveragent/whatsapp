import { normalizeShopDomain } from './normalize-shop';

/**
 * Shopify cart permalink — works with read-only OAuth scopes.
 * @see https://shopify.dev/docs/apps/build/checkout/create-cart-permalinks
 */
export function buildShopifyCartCheckoutUrl(args: {
  shopDomain: string;
  variantId: string | number;
  quantity?: number;
  /** Optional attribution query params appended to the URL. */
  attributes?: Record<string, string>;
}): string {
  const shop = normalizeShopDomain(args.shopDomain);
  if (!shop) throw new Error('Invalid shop domain');

  const qty = Math.max(1, Math.floor(args.quantity ?? 1));
  const base = `https://${shop}/cart/${args.variantId}:${qty}`;

  const attributes = args.attributes;
  if (!attributes || Object.keys(attributes).length === 0) {
    return base;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(attributes)) {
    if (!value.trim()) continue;
    params.set(`attributes[${key}]`, value.trim());
  }

  const query = params.toString();
  return query ? `${base}?${query}` : base;
}
