import type { SupabaseClient } from '@supabase/supabase-js';

import { isEcommerceBrand } from '@/lib/auth/brand-category';
import {
  DEFAULT_ECOMMERCE_PLATFORM,
  isEcommercePlatform,
  type EcommercePlatform,
} from './platform';

export type PlatformGuardResult =
  | { ok: true; platform: EcommercePlatform }
  | { ok: false; status: number; error: string };

export async function loadAccountEcommercePlatform(
  supabase: SupabaseClient,
  accountId: string,
): Promise<{ brand_category: string | null; ecommerce_platform: EcommercePlatform | null } | null> {
  const { data, error } = await supabase
    .from('accounts')
    .select('brand_category, ecommerce_platform')
    .eq('id', accountId)
    .maybeSingle();

  if (error || !data) return null;

  const platform = isEcommercePlatform(data.ecommerce_platform)
    ? data.ecommerce_platform
    : null;

  return {
    brand_category: (data.brand_category as string | null) ?? null,
    ecommerce_platform: platform,
  };
}

export async function assertEcommercePlatform(
  supabase: SupabaseClient,
  accountId: string,
  expected: EcommercePlatform,
): Promise<PlatformGuardResult> {
  const account = await loadAccountEcommercePlatform(supabase, accountId);
  if (!account) {
    return { ok: false, status: 404, error: 'Workspace not found' };
  }

  if (!isEcommerceBrand(account.brand_category as 'lead_gen' | 'ecommerce' | null)) {
    return {
      ok: false,
      status: 403,
      error: 'This workspace is not configured for ecommerce.',
    };
  }

  const platform = account.ecommerce_platform ?? DEFAULT_ECOMMERCE_PLATFORM;
  if (platform !== expected) {
    const label = expected === 'shopify' ? 'Shopify' : 'WooCommerce';
    return {
      ok: false,
      status: 409,
      error: `This brand uses ${platform === 'shopify' ? 'Shopify' : 'WooCommerce'}, not ${label}.`,
    };
  }

  return { ok: true, platform };
}

export async function ensureAccountEcommercePlatform(
  supabase: SupabaseClient,
  accountId: string,
  platform: EcommercePlatform,
): Promise<{ ok: false; status: number; error: string } | { ok: true }> {
  const account = await loadAccountEcommercePlatform(supabase, accountId);
  if (!account) {
    return { ok: false, status: 404, error: 'Workspace not found' };
  }

  if (!isEcommerceBrand(account.brand_category as 'lead_gen' | 'ecommerce' | null)) {
    return {
      ok: false,
      status: 403,
      error: 'This workspace is not configured for ecommerce.',
    };
  }

  const current = account.ecommerce_platform ?? DEFAULT_ECOMMERCE_PLATFORM;
  if (current !== platform) {
    return {
      ok: false,
      status: 409,
      error: `This brand is configured for ${current === 'shopify' ? 'Shopify' : 'WooCommerce'}.`,
    };
  }

  if (!account.ecommerce_platform) {
    const { error } = await supabase
      .from('accounts')
      .update({ ecommerce_platform: platform, updated_at: new Date().toISOString() })
      .eq('id', accountId);

    if (error) {
      console.error('[ecommerce] failed to set platform:', error);
      return { ok: false, status: 500, error: 'Failed to save platform setting' };
    }
  }

  return { ok: true };
}
