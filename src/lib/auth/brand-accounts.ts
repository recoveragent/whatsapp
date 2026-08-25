import type { PostgrestError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_BRAND_CATEGORY,
  isBrandCategory,
  isLeadGenBrand,
  type BrandCategory,
} from './brand-category';
import {
  DEFAULT_ECOMMERCE_PLATFORM,
  isEcommercePlatform,
  type EcommercePlatform,
} from '@/lib/ecommerce/platform';

export const BRAND_LIST_COLUMNS =
  'id, name, owner_user_id, created_at, brand_category, ecommerce_platform';

export interface BrandListRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: string;
  brand_category: BrandCategory;
  ecommerce_platform: EcommercePlatform | null;
}

export function isMissingColumnError(
  error: PostgrestError | null | undefined,
  column: string,
): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  const col = column.toLowerCase();
  return (
    msg.includes(col) &&
    (msg.includes('does not exist') ||
      msg.includes('could not find') ||
      error.code === '42703' ||
      error.code === 'PGRST204')
  );
}

export function isMissingRpcOverloadError(error: PostgrestError | null | undefined): boolean {
  if (!error?.message) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('create_brand_with_admin_invite') &&
    (msg.includes('could not find') ||
      msg.includes('function') ||
      msg.includes('p_brand_category') ||
      error.code === 'PGRST202')
  );
}

export const BRAND_CATEGORY_MIGRATION_HINT =
  'Run supabase/migrations/032_brand_category.sql in the Supabase SQL editor.';

/** List org brands; falls back when `brand_category` column is not migrated yet. */
export async function listOrganizationBrands(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ brands: BrandListRow[]; categoryColumnMissing: boolean }> {
  const withCategory = await supabase
    .from('accounts')
    .select(BRAND_LIST_COLUMNS)
    .eq('organization_id', organizationId)
    .order('name');

  if (!withCategory.error) {
    const brands = (withCategory.data ?? []).map((row) => ({
      ...row,
      brand_category: isBrandCategory(row.brand_category)
        ? row.brand_category
        : DEFAULT_BRAND_CATEGORY,
      ecommerce_platform: isEcommercePlatform(row.ecommerce_platform)
        ? row.ecommerce_platform
        : row.brand_category === 'ecommerce'
          ? DEFAULT_ECOMMERCE_PLATFORM
          : null,
    }));
    return { brands, categoryColumnMissing: false };
  }

  if (
    !isMissingColumnError(withCategory.error, 'brand_category') &&
    !isMissingColumnError(withCategory.error, 'ecommerce_platform')
  ) {
    throw withCategory.error;
  }

  const fallback = await supabase
    .from('accounts')
    .select('id, name, owner_user_id, created_at')
    .eq('organization_id', organizationId)
    .order('name');

  if (fallback.error) throw fallback.error;

  const brands = (fallback.data ?? []).map((row) => ({
    ...row,
    brand_category: DEFAULT_BRAND_CATEGORY,
    ecommerce_platform: null,
  }));

  return { brands, categoryColumnMissing: true };
}

export interface AccountWithCategory {
  id: string;
  name: string;
  default_currency: string | null;
  brand_category: BrandCategory;
  ecommerce_platform: EcommercePlatform | null;
}

/** Fetch one account; falls back when optional columns are not migrated yet. */
export async function fetchAccountWithCategory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AccountWithCategory | null> {
  const withCategory = await supabase
    .from('accounts')
    .select('id, name, default_currency, brand_category, ecommerce_platform')
    .eq('id', accountId)
    .maybeSingle();

  if (!withCategory.error && withCategory.data) {
    const category = isBrandCategory(withCategory.data.brand_category)
      ? withCategory.data.brand_category
      : DEFAULT_BRAND_CATEGORY;
    return {
      id: withCategory.data.id,
      name: withCategory.data.name,
      default_currency: withCategory.data.default_currency,
      brand_category: category,
      ecommerce_platform: isEcommercePlatform(withCategory.data.ecommerce_platform)
        ? withCategory.data.ecommerce_platform
        : category === 'ecommerce'
          ? DEFAULT_ECOMMERCE_PLATFORM
          : null,
    };
  }

  if (
    !isMissingColumnError(withCategory.error, 'brand_category') &&
    !isMissingColumnError(withCategory.error, 'ecommerce_platform')
  ) {
    return null;
  }

  const fallback = await supabase
    .from('accounts')
    .select('id, name, default_currency')
    .eq('id', accountId)
    .maybeSingle();

  if (!fallback.data) return null;

  return {
    ...fallback.data,
    brand_category: DEFAULT_BRAND_CATEGORY,
    ecommerce_platform: null,
  };
}

export async function accountIsLeadGen(
  supabase: SupabaseClient,
  accountId: string,
): Promise<boolean> {
  const account = await fetchAccountWithCategory(supabase, accountId);
  return isLeadGenBrand(account?.brand_category);
}

/** Account ids in `accountIds` whose brand category is lead gen. */
export async function leadGenAccountIds(
  supabase: SupabaseClient,
  accountIds: string[],
): Promise<Set<string>> {
  const unique = [...new Set(accountIds.filter(Boolean))];
  if (unique.length === 0) return new Set();

  const withCategory = await supabase
    .from('accounts')
    .select('id, brand_category')
    .in('id', unique);

  if (!withCategory.error) {
    return new Set(
      (withCategory.data ?? [])
        .filter((row) => isLeadGenBrand(row.brand_category))
        .map((row) => row.id as string),
    );
  }

  if (isMissingColumnError(withCategory.error, 'brand_category')) {
    return new Set(unique);
  }

  console.error('[leadGenAccountIds]', withCategory.error);
  return new Set();
}
