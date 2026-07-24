import { getConfiguredSiteUrl, getServerRedirectOrigin } from '@/lib/auth/site-url';

const DEFAULT_SCOPES = [
  'read_orders',
  'read_fulfillments',
  'read_checkouts',
  'read_customers',
].join(',');

export const SHOPIFY_API_VERSION = '2025-01';

export function getShopifyApiKey(): string {
  const key = process.env.SHOPIFY_API_KEY;
  if (!key) throw new Error('SHOPIFY_API_KEY is not configured');
  return key;
}

export function getShopifyApiSecret(): string {
  const secret = process.env.SHOPIFY_API_SECRET;
  if (!secret) throw new Error('SHOPIFY_API_SECRET is not configured');
  return secret;
}

export function getShopifyScopes(): string {
  return process.env.SHOPIFY_SCOPES?.trim() || DEFAULT_SCOPES;
}

/**
 * OAuth redirect URI shown to merchants and sent to Shopify.
 * Prefers NEXT_PUBLIC_SITE_URL / SITE_URL so local hosts like
 * https://0.0.0.0:3000 never appear in the custom-app setup instructions.
 */
export function getShopifyRedirectUri(request: Request): string {
  const origin =
    getServerRedirectOrigin(request) ||
    getConfiguredSiteUrl() ||
    new URL(request.url).origin;
  return `${origin.replace(/\/$/, '')}/api/shopify/oauth/callback`;
}

export function isShopifyOAuthConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}
