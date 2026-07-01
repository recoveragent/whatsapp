import type { PostgrestError } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  DEFAULT_BRAND_CATEGORY,
  isBrandCategory,
  type BrandCategory,
} from './brand-category';

export const BRAND_LIST_COLUMNS = 'id, name, owner_user_id, created_at, brand_category';

export interface BrandListRow {
  id: string;
  name: string;
  owner_user_id: string | null;
  created_at: string;
  brand_category: BrandCategory;
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
    }));
    return { brands, categoryColumnMissing: false };
  }

  if (!isMissingColumnError(withCategory.error, 'brand_category')) {
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
  }));

  return { brands, categoryColumnMissing: true };
}

export interface AccountWithCategory {
  id: string;
  name: string;
  default_currency: string | null;
  brand_category: BrandCategory;
}

/** Fetch one account; falls back when `brand_category` is not migrated yet. */
export async function fetchAccountWithCategory(
  supabase: SupabaseClient,
  accountId: string,
): Promise<AccountWithCategory | null> {
  const withCategory = await supabase
    .from('accounts')
    .select('id, name, default_currency, brand_category')
    .eq('id', accountId)
    .maybeSingle();

  if (!withCategory.error && withCategory.data) {
    return {
      id: withCategory.data.id,
      name: withCategory.data.name,
      default_currency: withCategory.data.default_currency,
      brand_category: isBrandCategory(withCategory.data.brand_category)
        ? withCategory.data.brand_category
        : DEFAULT_BRAND_CATEGORY,
    };
  }

  if (!isMissingColumnError(withCategory.error, 'brand_category')) {
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
  };
}
