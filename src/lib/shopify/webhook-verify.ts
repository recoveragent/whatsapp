import crypto from 'crypto';

import { getShopifyApiSecret } from './config';

/**
 * Verify Shopify webhook HMAC (X-Shopify-Hmac-Sha256).
 * @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */
export function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
): boolean {
  if (!hmacHeader) return false;

  const digest = crypto
    .createHmac('sha256', getShopifyApiSecret())
    .update(rawBody, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(digest),
      Buffer.from(hmacHeader),
    );
  } catch {
    return false;
  }
}
