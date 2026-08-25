import type { BrandCategory } from '@/lib/auth/brand-category';
import { isEcommerceBrand } from '@/lib/auth/brand-category';

export type EcommercePlatform = 'shopify' | 'woocommerce';

export const ECOMMERCE_PLATFORMS: readonly EcommercePlatform[] = [
  'shopify',
  'woocommerce',
] as const;

export const ECOMMERCE_PLATFORM_LABELS: Record<EcommercePlatform, string> = {
  shopify: 'Shopify',
  woocommerce: 'WooCommerce',
};

export const DEFAULT_ECOMMERCE_PLATFORM: EcommercePlatform = 'shopify';

export function isEcommercePlatform(value: unknown): value is EcommercePlatform {
  return value === 'shopify' || value === 'woocommerce';
}

/** Resolve platform for an ecommerce brand; defaults legacy rows to Shopify. */
export function resolveEcommercePlatform(
  category: BrandCategory | null | undefined,
  platform: EcommercePlatform | null | undefined,
): EcommercePlatform | null {
  if (!isEcommerceBrand(category)) return null;
  return platform ?? DEFAULT_ECOMMERCE_PLATFORM;
}

export function isShopifyPlatform(
  category: BrandCategory | null | undefined,
  platform: EcommercePlatform | null | undefined,
): boolean {
  return resolveEcommercePlatform(category, platform) === 'shopify';
}

export function isWooCommercePlatform(
  category: BrandCategory | null | undefined,
  platform: EcommercePlatform | null | undefined,
): boolean {
  return resolveEcommercePlatform(category, platform) === 'woocommerce';
}
