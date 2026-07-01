export type BrandCategory = 'lead_gen' | 'ecommerce';

export const BRAND_CATEGORIES: readonly BrandCategory[] = ['lead_gen', 'ecommerce'] as const;

export const BRAND_CATEGORY_LABELS: Record<BrandCategory, string> = {
  lead_gen: 'Lead gen',
  ecommerce: 'Ecommerce',
};

export const DEFAULT_BRAND_CATEGORY: BrandCategory = 'lead_gen';

export function isBrandCategory(value: unknown): value is BrandCategory {
  return value === 'lead_gen' || value === 'ecommerce';
}

export function isLeadGenBrand(category: BrandCategory | null | undefined): boolean {
  return (category ?? DEFAULT_BRAND_CATEGORY) === 'lead_gen';
}

export function isEcommerceBrand(category: BrandCategory | null | undefined): boolean {
  return category === 'ecommerce';
}
