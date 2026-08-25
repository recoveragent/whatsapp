import crypto from 'crypto';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeStoreUrl } from './normalize-store-url';

/**
 * Verify WooCommerce webhook signature (X-WC-Webhook-Signature).
 *
 * @see https://woocommerce.github.io/code-reference/classes/WC-Webhook.html
 */
export async function verifyWooCommerceWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  storeUrl: string | null,
): Promise<boolean> {
  if (!signatureHeader || !storeUrl) return false;

  const secret = await resolveWebhookSecret(storeUrl);
  if (!secret) {
    throw new Error('WooCommerce webhook verification not configured');
  }

  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signatureHeader));
  } catch {
    return false;
  }
}

async function resolveWebhookSecret(storeUrl: string): Promise<string | null> {
  const normalized = normalizeStoreUrl(storeUrl);
  if (!normalized) return null;

  const { data } = await supabaseAdmin()
    .from('woocommerce_config')
    .select('webhook_secret, status')
    .eq('store_url', normalized)
    .maybeSingle();

  if (!data || data.status !== 'connected' || !data.webhook_secret) return null;

  try {
    return decrypt(data.webhook_secret as string);
  } catch {
    console.warn('[woocommerce webhook] could not decrypt webhook_secret for', normalized);
    return null;
  }
}
