/** Auto-applied WooCommerce audience tags (prefix keeps them grouped in UI). */
export const WOO_TAG_NAMES = {
  customer: 'woo:customer',
  repeatBuyer: 'woo:repeat-buyer',
  oneTimeBuyer: 'woo:one-time-buyer',
  recent30d: 'woo:recent-30d',
  inactive90d: 'woo:inactive-90d',
  highValue: 'woo:high-value',
  cod: 'woo:cod',
} as const;

export type WooTagName = (typeof WOO_TAG_NAMES)[keyof typeof WOO_TAG_NAMES];

/** LTV threshold (INR-equivalent default; refine per-brand later). */
export const WOO_HIGH_VALUE_THRESHOLD = 5000;

export const WOO_INACTIVE_DAYS = 90;
export const WOO_RECENT_DAYS = 30;
