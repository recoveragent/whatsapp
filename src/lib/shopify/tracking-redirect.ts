import { randomBytes } from 'crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { getConfiguredSiteUrl } from '@/lib/auth/site-url';
import type { ShopifyEventContext } from './types';

/** How long a tracking redirect token stays valid. */
export const TRACKING_REDIRECT_TTL_DAYS = 90;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function isValidTrackingRedirectToken(token: string): boolean {
  return TOKEN_PATTERN.test(token.trim());
}

export function isValidTrackingRedirectTarget(url: string): boolean {
  try {
    const parsed = new URL(url.trim());
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** WhatsApp URL button prefix — merchants register `…/t/{{1}}` on Meta. */
export function getWhatsAppTrackingButtonUrlTemplate(): string {
  const base = getConfiguredSiteUrl();
  return base ? `${base}/t/{{1}}` : 'https://YOUR_SITE_URL/t/{{1}}';
}

export function buildTrackingRedirectUrl(token: string): string {
  const base = getConfiguredSiteUrl();
  if (!base) {
    throw new Error(
      'NEXT_PUBLIC_SITE_URL is not configured — cannot build tracking redirect URL.',
    );
  }
  return `${base}/t/${encodeURIComponent(token.trim())}`;
}

function generateTrackingRedirectToken(): string {
  return randomBytes(16).toString('base64url');
}

function redirectExpiresAt(): string {
  return new Date(
    Date.now() + TRACKING_REDIRECT_TTL_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
}

export async function ensureShopifyTrackingRedirect(
  db: SupabaseClient,
  args: {
    accountId: string;
    targetUrl: string;
    shopifyOrderId?: string | number | null;
    shopifyFulfillmentId?: string | number | null;
  },
): Promise<string | null> {
  const targetUrl = args.targetUrl.trim();
  if (!targetUrl || !isValidTrackingRedirectTarget(targetUrl)) return null;

  const shopifyFulfillmentId =
    args.shopifyFulfillmentId != null
      ? String(args.shopifyFulfillmentId)
      : null;
  const shopifyOrderId =
    args.shopifyOrderId != null ? String(args.shopifyOrderId) : null;
  const expiresAt = redirectExpiresAt();
  const now = new Date().toISOString();

  if (shopifyFulfillmentId) {
    const { data: existing } = await db
      .from('shopify_tracking_redirects')
      .select('token, target_url')
      .eq('account_id', args.accountId)
      .eq('shopify_fulfillment_id', shopifyFulfillmentId)
      .maybeSingle();

    if (existing?.token) {
      if (existing.target_url !== targetUrl) {
        await db
          .from('shopify_tracking_redirects')
          .update({
            target_url: targetUrl,
            shopify_order_id: shopifyOrderId,
            expires_at: expiresAt,
            updated_at: now,
          })
          .eq('account_id', args.accountId)
          .eq('shopify_fulfillment_id', shopifyFulfillmentId);
      }
      return existing.token;
    }
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = generateTrackingRedirectToken();
    const { error } = await db.from('shopify_tracking_redirects').insert({
      account_id: args.accountId,
      token,
      target_url: targetUrl,
      shopify_order_id: shopifyOrderId,
      shopify_fulfillment_id: shopifyFulfillmentId,
      expires_at: expiresAt,
    });

    if (!error) return token;

    if (error.code === '23505' && shopifyFulfillmentId) {
      const { data: raced } = await db
        .from('shopify_tracking_redirects')
        .select('token')
        .eq('account_id', args.accountId)
        .eq('shopify_fulfillment_id', shopifyFulfillmentId)
        .maybeSingle();
      if (raced?.token) return raced.token;
    }

    if (error.code !== '23505') {
      console.error('[shopify] ensureShopifyTrackingRedirect failed:', error);
      return null;
    }
  }

  return null;
}

export async function resolveShopifyTrackingRedirect(
  db: SupabaseClient,
  token: string,
): Promise<string | null> {
  const normalized = token.trim();
  if (!isValidTrackingRedirectToken(normalized)) return null;

  const { data, error } = await db
    .from('shopify_tracking_redirects')
    .select('target_url, expires_at')
    .eq('token', normalized)
    .maybeSingle();

  if (error || !data?.target_url) return null;

  const expiresAt = data.expires_at ? Date.parse(String(data.expires_at)) : NaN;
  if (Number.isFinite(expiresAt) && expiresAt < Date.now()) return null;

  const target = String(data.target_url).trim();
  return isValidTrackingRedirectTarget(target) ? target : null;
}

export async function enrichContextWithTrackingRedirect(
  db: SupabaseClient,
  accountId: string,
  context: ShopifyEventContext,
  args?: {
    shopifyFulfillmentId?: string | number | null;
    shopifyOrderId?: string | number | null;
  },
): Promise<ShopifyEventContext> {
  const trackingUrl = context.trackingUrl?.trim();
  if (!trackingUrl) return context;

  const token = await ensureShopifyTrackingRedirect(db, {
    accountId,
    targetUrl: trackingUrl,
    shopifyOrderId: args?.shopifyOrderId,
    shopifyFulfillmentId: args?.shopifyFulfillmentId,
  });

  if (!token) return context;

  return {
    ...context,
    trackingRedirectSuffix: token,
  };
}
