import crypto from 'crypto';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeShopDomain } from './normalize-shop';
import { getShopifyApiSecret, isShopifyOAuthConfigured } from './config';

/**
 * Verify Shopify webhook HMAC (X-Shopify-Hmac-Sha256).
 * Prefers the brand's stored custom-app Client Secret; falls back to
 * the server-wide SHOPIFY_API_SECRET for legacy shared-app installs.
 *
 * @see https://shopify.dev/docs/apps/build/webhooks/subscribe/https
 */
export async function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  shopDomain: string | null,
): Promise<boolean> {
  if (!hmacHeader) return false;

  const secrets = await resolveWebhookSecrets(shopDomain);
  if (secrets.length === 0) {
    throw new Error('Shopify webhook verification not configured');
  }

  for (const secret of secrets) {
    if (hmacMatches(rawBody, hmacHeader, secret)) return true;
  }
  return false;
}

function hmacMatches(rawBody: string, hmacHeader: string, secret: string): boolean {
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

async function resolveWebhookSecrets(shopDomain: string | null): Promise<string[]> {
  const secrets: string[] = [];
  const normalized = shopDomain ? normalizeShopDomain(shopDomain) : null;

  if (normalized) {
    const { data } = await supabaseAdmin()
      .from('shopify_config')
      .select('api_secret')
      .eq('shop_domain', normalized)
      .maybeSingle();

    if (data?.api_secret) {
      try {
        secrets.push(decrypt(data.api_secret as string));
      } catch {
        console.warn('[shopify webhook] could not decrypt brand api_secret for', normalized);
      }
    }
  }

  // Legacy shared Partner app — keep as fallback for older connections.
  if (isShopifyOAuthConfigured()) {
    try {
      const envSecret = getShopifyApiSecret();
      if (envSecret && !secrets.includes(envSecret)) secrets.push(envSecret);
    } catch {
      // ignore missing env
    }
  }

  return secrets;
}
