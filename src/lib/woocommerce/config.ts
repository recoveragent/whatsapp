import { getConfiguredSiteUrl, getServerRedirectOrigin } from '@/lib/auth/site-url';
import { isLocalWebhookUrl } from '@/lib/shopify/format-api-error';

export const WOOCOMMERCE_API_VERSION = 'wc/v3';

/**
 * Public HTTPS origin for WooCommerce webhooks.
 * Never returns localhost — WooCommerce must reach a public URL.
 */
export function getWooCommercePublicOrigin(request: Request): string | null {
  const origin =
    getServerRedirectOrigin(request) || getConfiguredSiteUrl() || null;
  if (!origin) return null;
  if (isLocalWebhookUrl(origin)) return null;
  return origin.replace(/\/$/, '');
}

/** Webhook callback WooCommerce will POST to. */
export function getWooCommerceWebhookUrl(request: Request): string {
  const origin = getWooCommercePublicOrigin(request);
  if (!origin) {
    throw new Error(
      'Set NEXT_PUBLIC_SITE_URL to your public HTTPS domain before connecting WooCommerce. Local addresses cannot receive webhooks.',
    );
  }
  return `${origin}/api/woocommerce/webhook`;
}
