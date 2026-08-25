import { decrypt } from '@/lib/whatsapp/encryption';
import {
  fetchFirstOrderProductImageUrl,
  fetchOrder,
  fetchProductImageUrl,
} from './admin-api';
import {
  firstProductIdFromLineItems,
  imageUrlFromLineItems,
} from './extract-context';
import type {
  ShopifyCheckoutPayload,
  ShopifyEventContext,
  ShopifyLineItemFields,
  ShopifyOrderPayload,
} from './types';

/**
 * REST order/checkout webhooks omit product images. Enrich context via
 * Admin API when `productImage` is still empty.
 */
export async function enrichContextProductImage(args: {
  context: ShopifyEventContext;
  shopDomain: string;
  /** Encrypted access token from shopify_config. */
  encryptedAccessToken: string;
  orderId?: string | number | null;
  lineItems?: ShopifyLineItemFields[] | null;
}): Promise<ShopifyEventContext> {
  if (args.context.productImage) return args.context;

  let accessToken: string;
  try {
    accessToken = decrypt(args.encryptedAccessToken);
  } catch (err) {
    console.warn('[shopify] decrypt for product image failed:', err);
    return args.context;
  }

  let url: string | null = null;

  if (args.orderId != null && String(args.orderId).trim()) {
    try {
      url = await fetchFirstOrderProductImageUrl(
        args.shopDomain,
        accessToken,
        args.orderId,
      );
    } catch (err) {
      console.warn('[shopify] order product image lookup failed:', err);
    }
  }

  if (!url) {
    const productId = firstProductIdFromLineItems(args.lineItems ?? undefined);
    if (productId) {
      try {
        url = await fetchProductImageUrl(
          args.shopDomain,
          accessToken,
          productId,
        );
      } catch (err) {
        console.warn('[shopify] product image lookup failed:', err);
      }
    }
  }

  // REST Admin order payloads often include line-item images and product_ids
  // even when GraphQL and webhook line items do not.
  if (!url && args.orderId != null && String(args.orderId).trim()) {
    try {
      const order = (await fetchOrder(
        args.shopDomain,
        accessToken,
        args.orderId,
      )) as ShopifyOrderPayload | null;
      if (order) {
        url = imageUrlFromLineItems(order.line_items);
        if (!url) {
          const productId = firstProductIdFromLineItems(order.line_items);
          if (productId) {
            url = await fetchProductImageUrl(
              args.shopDomain,
              accessToken,
              productId,
            );
          }
        }
      }
    } catch (err) {
      console.warn('[shopify] REST order product image lookup failed:', err);
    }
  }

  if (!url) return args.context;
  return { ...args.context, productImage: url };
}

export async function enrichOrderContextImage(args: {
  context: ShopifyEventContext;
  order: ShopifyOrderPayload;
  shopDomain: string;
  encryptedAccessToken: string;
}): Promise<ShopifyEventContext> {
  return enrichContextProductImage({
    context: args.context,
    shopDomain: args.shopDomain,
    encryptedAccessToken: args.encryptedAccessToken,
    orderId: args.order.id,
    lineItems: args.order.line_items,
  });
}

export async function enrichCheckoutContextImage(args: {
  context: ShopifyEventContext;
  checkout: ShopifyCheckoutPayload;
  shopDomain: string;
  encryptedAccessToken: string;
}): Promise<ShopifyEventContext> {
  return enrichContextProductImage({
    context: args.context,
    shopDomain: args.shopDomain,
    encryptedAccessToken: args.encryptedAccessToken,
    lineItems: args.checkout.line_items,
  });
}
