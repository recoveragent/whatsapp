import { supabaseAdmin } from '@/lib/supabase/admin';
import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { normalizeShopDomain } from './normalize-shop';

/** Client credentials tokens expire after 24h. OAuth installations without
 * this grant continue to report their original authentication failure. */
export async function requestShopifyClientToken(
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
    throw new Error('Invalid shop domain');
  }
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId.trim(),
      client_secret: clientSecret.trim(),
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || typeof body?.access_token !== 'string' || !body.access_token.trim()) {
    // Never include the token endpoint's response, which can contain secrets.
    throw new Error(`Shopify token renewal failed (HTTP ${response.status}); check the app credentials and installation`);
  }
  return body.access_token.trim();
}

const renewals = new Map<string, Promise<string | null>>();

export async function renewStoredShopifyToken(shopDomain: string, rejectedToken: string): Promise<string | null> {
  const shop = normalizeShopDomain(shopDomain);
  if (!shop) return null;
  const pending = renewals.get(shop);
  if (pending) return pending;
  const operation = renew(shop, rejectedToken);
  renewals.set(shop, operation);
  try {
    return await operation;
  } finally {
    renewals.delete(shop);
  }
}

async function renew(shop: string, rejectedToken: string): Promise<string | null> {
  const db = supabaseAdmin();
  const { data: config, error } = await db.from('shopify_config')
    .select('account_id, access_token, api_key, api_secret, status')
    .eq('shop_domain', shop).maybeSingle();
  if (error) throw new Error('Could not load Shopify credentials for renewal');
  if (!config || config.status !== 'connected') return null;
  const stored = decrypt(config.access_token);
  if (stored !== rejectedToken) return stored;
  if (!config.api_key || !config.api_secret) return null;
  const token = await requestShopifyClientToken(shop, config.api_key, decrypt(config.api_secret));
  const { error: saveError } = await db.from('shopify_config')
    .update({ access_token: encrypt(token), updated_at: new Date().toISOString() })
    .eq('account_id', config.account_id).eq('access_token', config.access_token)
    .eq('status', 'connected');
  if (saveError) throw new Error('Could not save renewed Shopify credentials');
  return token;
}
