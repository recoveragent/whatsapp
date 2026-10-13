import crypto from 'crypto';

import { supabaseAdmin } from '@/lib/automations/admin-client';
import { decrypt } from '@/lib/whatsapp/encryption';
import { normalizeShopDomain } from './normalize-shop';
import { getShopifyApiSecret, isShopifyOAuthConfigured } from './config';

type SecretSource = 'brand' | 'environment';
type CredentialState =
  | 'not_checked'
  | 'invalid_shop'
  | 'lookup_failed'
  | 'missing_shop'
  | 'missing_secret'
  | 'decrypt_failed'
  | 'ready';

/** Verify the raw body before parsing. Logs metadata only, never signatures or secrets. */
export async function verifyShopifyWebhookHmac(
  rawBody: string,
  hmacHeader: string | null,
  shopDomain: string | null,
  context: { webhookId?: string | null; topic?: string | null } = {}
): Promise<boolean> {
  const diagnostic = {
    webhook_id: context.webhookId ?? null,
    topic: context.topic ?? null,
    shop: shopDomain ? normalizeShopDomain(shopDomain) : null,
    brand_credentials: 'not_checked' as CredentialState,
    environment_secret_available: false,
    matched_source: null as SecretSource | null,
    outcome: 'missing_hmac',
  };
  const report = () => {
    if (diagnostic.outcome === 'verified') {
      console.info('[shopify webhook] verification', diagnostic);
    } else {
      console.warn('[shopify webhook] verification', diagnostic);
    }
  };
  if (!hmacHeader) {
    report();
    return false;
  }

  const secrets: { value: string; source: SecretSource }[] = [];
  if (!diagnostic.shop) {
    diagnostic.brand_credentials = 'invalid_shop';
  } else {
    try {
      const { data, error } = await supabaseAdmin()
        .from('shopify_config')
        .select('api_secret')
        .eq('shop_domain', diagnostic.shop)
        .maybeSingle();
      if (error) {
        diagnostic.brand_credentials = 'lookup_failed';
      } else if (!data) {
        diagnostic.brand_credentials = 'missing_shop';
      } else if (!data.api_secret) {
        diagnostic.brand_credentials = 'missing_secret';
      } else {
        try {
          const value = decrypt(data.api_secret as string);
          diagnostic.brand_credentials = value ? 'ready' : 'missing_secret';
          if (value) secrets.push({ value, source: 'brand' });
        } catch {
          diagnostic.brand_credentials = 'decrypt_failed';
        }
      }
    } catch {
      diagnostic.brand_credentials = 'lookup_failed';
    }
  }

  // Preserve legacy shared-app fallback. Never log raw exceptions or credentials.
  if (isShopifyOAuthConfigured()) {
    try {
      const value = getShopifyApiSecret();
      diagnostic.environment_secret_available = Boolean(value);
      if (value && !secrets.some((secret) => secret.value === value)) {
        secrets.push({ value, source: 'environment' });
      }
    } catch {
      // Missing environment configuration is reported by availability above.
    }
  }
  if (secrets.length === 0) {
    diagnostic.outcome = 'unavailable';
    report();
    throw new Error('Shopify webhook verification not configured');
  }
  for (const secret of secrets) {
    if (hmacMatches(rawBody, hmacHeader, secret.value)) {
      diagnostic.matched_source = secret.source;
      diagnostic.outcome = 'verified';
      report();
      return true;
    }
  }
  diagnostic.outcome = 'signature_mismatch';
  report();
  return false;
}

function hmacMatches(
  rawBody: string,
  hmacHeader: string,
  secret: string
): boolean {
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
