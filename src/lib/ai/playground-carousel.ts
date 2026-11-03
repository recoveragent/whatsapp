import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import { formatShopifyProductPrice } from '@/lib/shopify/send-product-card';
import { DEFAULT_PRODUCT_BUTTON_LABELS } from '@/lib/shopify/product-checkout-url';

export interface PlaygroundCarouselProduct {
  title: string;
  variant_title: string | null;
  shopify_variant_id: number;
  price: string;
  currency: string | null;
  image_url: string | null;
  formatted_price: string;
}

export interface PlaygroundProductCarousel {
  button_label: string;
  products: PlaygroundCarouselProduct[];
  /** False when Sell on WhatsApp is off — preview only, live send would fall back to text. */
  live_ready: boolean;
}

export function buildPlaygroundProductCarousel(
  products: ShopifyCatalogProduct[],
  liveReady: boolean,
): PlaygroundProductCarousel {
  return {
    // Matches the live AI carousel, which links to the product page.
    button_label: DEFAULT_PRODUCT_BUTTON_LABELS.product_page,
    live_ready: liveReady,
    products: products.map((product) => ({
      title: product.title,
      variant_title: product.variant_title,
      shopify_variant_id: product.shopify_variant_id,
      price: product.price,
      currency: product.currency,
      image_url: product.image_url,
      formatted_price: formatShopifyProductPrice(product.price, product.currency),
    })),
  };
}
