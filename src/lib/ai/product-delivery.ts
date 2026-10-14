import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import { buildShopifyCartCheckoutUrl } from '@/lib/shopify/product-checkout-url';

export interface RecommendationStore {
  shopDomain: string;
  carouselEnabled: boolean;
}

export async function loadRecommendationStore(
  db: SupabaseClient,
  accountId: string
): Promise<RecommendationStore | null> {
  const { data, error } = await db
    .from('shopify_config')
    .select('shop_domain, status, sell_on_whatsapp_enabled')
    .eq('account_id', accountId)
    .maybeSingle();
  if (
    error ||
    data?.status !== 'connected' ||
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(data.shop_domain ?? '')
  )
    return null;
  return {
    shopDomain: data.shop_domain,
    carouselEnabled: !!data.sell_on_whatsapp_enabled,
  };
}

export function canDeliverProductCarousel(
  products: ShopifyCatalogProduct[],
  store: RecommendationStore | null
): boolean {
  return (
    !!store?.carouselEnabled &&
    products.length >= 2 &&
    products.length <= 4 &&
    products.every((product) => !!product.image_url?.trim())
  );
}

/** Catalog-derived text and links, appended by the server rather than invented
 * by the model. Used for one match, missing images, disabled carousels, and
 * failed carousel sends. No checkout/order is created by making a permalink.
 */
export function buildRecommendationText(
  products: ShopifyCatalogProduct[],
  store: RecommendationStore | null
): string {
  if (!store || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(store.shopDomain))
    return '';
  return products
    .slice(0, 4)
    .filter(
      (product) =>
        Number.isSafeInteger(product.shopify_variant_id) &&
        product.shopify_variant_id > 0
    )
    .map((product) => {
      const title = product.title.replace(/[\r\n]+/g, ' ').slice(0, 180);
      const variant =
        product.variant_title &&
        product.variant_title.toLowerCase() !== 'default title'
          ? ` (${product.variant_title.replace(/[\r\n]+/g, ' ').slice(0, 80)})`
          : '';
      const price = `${product.currency ?? ''} ${product.price}`.trim();
      const url = buildShopifyCartCheckoutUrl({
        shopDomain: store.shopDomain,
        variantId: product.shopify_variant_id,
      });
      // Respect the merchant's product-send switch. Informational catalog
      // text can still answer questions, but checkout links require opt-in.
      return `${title}${variant}\n${price}${store.carouselEnabled ? `\n${url}` : ''}`;
    })
    .join('\n\n');
}

export function appendRecommendationText(
  text: string,
  products: ShopifyCatalogProduct[],
  store: RecommendationStore | null
): string {
  const details = buildRecommendationText(products, store);
  // Meta text bodies are limited to 4096 characters. Reserve room for the
  // authoritative product details, which are bounded above.
  return details
    ? `${text.slice(0, Math.max(0, 4096 - details.length - 2))}\n\n${details}`
    : text;
}
