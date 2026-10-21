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

/**
 * Storefront product page with the variant preselected. The myshopify
 * domain redirects to the store's primary domain.
 */
export function buildShopifyProductPageUrl(args: {
  shopDomain: string;
  handle: string;
  variantId: string | number;
}): string {
  const shop = normalizeShopDomain(args.shopDomain);
  if (!shop) throw new Error('Invalid shop domain');

  const params = new URLSearchParams({
    variant: String(args.variantId),
    utm_source: 'whatsapp',
    utm_medium: 'wacrm',
  });
  return `https://${shop}/products/${encodeURIComponent(args.handle)}?${params.toString()}`;
}

/** Where a product card's button sends the customer. */
export type ProductLinkTarget = 'checkout' | 'product_page';

export const DEFAULT_PRODUCT_BUTTON_LABELS: Record<ProductLinkTarget, string> = {
  checkout: 'Buy now',
  product_page: 'View product',
};

/**
 * Button URL for a product card. A product page needs the product handle;
 * without one (catalog synced before handles were stored) it falls back to
 * the cart permalink so the button still works.
 */
export function buildProductCardUrl(args: {
  linkTarget?: ProductLinkTarget;
  shopDomain: string;
  variantId: string | number;
  handle?: string | null;
  quantity?: number;
  attributes?: Record<string, string>;
}): string {
  const handle = args.handle?.trim();
  if (args.linkTarget === 'product_page' && handle) {
    return buildShopifyProductPageUrl({
      shopDomain: args.shopDomain,
      handle,
      variantId: args.variantId,
    });
  }
  return buildShopifyCartCheckoutUrl({
    shopDomain: args.shopDomain,
    variantId: args.variantId,
    quantity: args.quantity,
    attributes: args.attributes,
  });
}
