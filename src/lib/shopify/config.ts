import { getConfiguredSiteUrl, getServerRedirectOrigin } from '@/lib/auth/site-url';
import { isLocalWebhookUrl } from './format-api-error';

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
 * Public HTTPS origin for Shopify OAuth + webhooks.
 * Never returns localhost / 0.0.0.0 — Shopify rejects those.
 */
export function getShopifyPublicOrigin(request: Request): string | null {
  const origin =
    getServerRedirectOrigin(request) || getConfiguredSiteUrl() || null;
  if (!origin) return null;
  if (isLocalWebhookUrl(origin)) return null;
  return origin.replace(/\/$/, '');
}

/**
 * OAuth redirect URI shown to merchants and sent to Shopify.
 */
export function getShopifyRedirectUri(request: Request): string {
  const origin =
    getShopifyPublicOrigin(request) ||
    getConfiguredSiteUrl()?.replace(/\/$/, '') ||
    new URL(request.url).origin.replace(/\/$/, '');
  return `${origin}/api/shopify/oauth/callback`;
}

/** Webhook callback Shopify will POST to — must be a public HTTPS URL. */
export function getShopifyWebhookUrl(request: Request): string {
  const origin = getShopifyPublicOrigin(request);
  if (!origin) {
    throw new Error(
      'Set NEXT_PUBLIC_SITE_URL to your public HTTPS domain (e.g. https://wa.recoveragent.ai) before connecting Shopify. Local addresses like 0.0.0.0 cannot receive webhooks.',
    );
  }
  return `${origin}/api/shopify/webhook`;
}

/** Settings page after OAuth — prefer public site so the browser is not sent to 0.0.0.0. */
export function getShopifySettingsOrigin(request: Request): string {
  return (
    getShopifyPublicOrigin(request) ||
    getConfiguredSiteUrl()?.replace(/\/$/, '') ||
    new URL(request.url).origin.replace(/\/$/, '')
  );
}

export function isShopifyOAuthConfigured(): boolean {
  return Boolean(process.env.SHOPIFY_API_KEY && process.env.SHOPIFY_API_SECRET);
}
