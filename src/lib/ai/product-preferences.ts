import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import type { ChatMessage } from './types';
import { isHumanSupportQuery, isOrderSupportQuery } from './commerce-intent';

export interface ProductPreferences {
  minPrice?: number;
  maxPrice?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
  currency?: string;
  /** "$" alone cannot distinguish USD, CAD, AUD, etc. */
  ambiguousCurrency?: boolean;
  size?: string;
  unsupportedSize?: boolean;
}

const ISO_CURRENCIES = new Set(Intl.supportedValuesOf('currency'));
const CURRENCY_CODE = `(?:${[...ISO_CURRENCIES].join('|')})`;
const CURRENCY = `(?:${CURRENCY_CODE}(?![A-Za-z])|₹|€|£|\\$|rs\\.?)`;
const AMOUNT = `(?:${CURRENCY}\\s*)?\\d[\\d,]*(?:\\.\\d{1,2})?\\s*k?(?:\\s*${CURRENCY})?`;
const SIZE =
  '(?:extra[ -]small|extra[ -]large|small|medium|large|xxxl|xxl|xxs|3xl|2xl|xs|xl|s|m|l|(?:UK|US|EU)\\s*\\d{1,2}(?:\\.\\d{1,2})?|\\d{1,2}(?:\\.\\d{1,2})?)';

export function shoppingUserMessages(messages: ChatMessage[]): ChatMessage[] {
  const users = messages.filter((message) => message.role === 'user');
  const boundary = users
    .slice(0, -1)
    .findLastIndex(
      (message) =>
        isOrderSupportQuery(message.content) ||
        isHumanSupportQuery(message.content)
    );
  return users.slice(boundary + 1);
}

function money(raw: string): {
  value: number;
  currency?: string;
  ambiguousCurrency?: boolean;
} {
  const codeMatch = raw.match(new RegExp(CURRENCY_CODE, 'i'));
  const rawCode = codeMatch?.[0];
  // ALL/TRY/TOP/etc. are also ordinary English words. A lowercase word
  // following the amount ("under 1000 all colors") is not a currency.
  const isTrailingWord =
    rawCode &&
    ['ALL', 'TRY', 'TOP', 'BOB', 'PEN', 'MAD'].includes(
      rawCode.toUpperCase()
    ) &&
    rawCode !== rawCode.toUpperCase() &&
    (codeMatch?.index ?? 0) > raw.search(/\d/);
  const code = isTrailingWord ? undefined : rawCode?.toUpperCase();
  const currency =
    code ??
    (/₹|\brs\.?/i.test(raw)
      ? 'INR'
      : raw.includes('€')
        ? 'EUR'
        : raw.includes('£')
          ? 'GBP'
          : undefined);
  const digits =
    raw.match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0].replaceAll(',', '') ?? '';
  return {
    value: Number(digits) * (/\d\s*k\b/i.test(raw) ? 1000 : 1),
    currency,
    ambiguousCurrency:
      (raw.includes('$') && !code) ||
      (!!code &&
        ((raw.includes('₹') && code !== 'INR') ||
          (raw.includes('€') && code !== 'EUR') ||
          (raw.includes('£') && code !== 'GBP'))),
  };
}

export function normalizeProductSize(size: string): string {
  const compact = size.toLowerCase().replace(/[\s-]+/g, '');
  return (
    (
      {
        small: 's',
        medium: 'm',
        large: 'l',
        extrasmall: 'xs',
        extralarge: 'xl',
        '2xl': 'xxl',
        '3xl': 'xxxl',
      } as Record<string, string>
    )[compact] ?? compact
  );
}

/** Recognize explicit, bounded preferences; arbitrary numbers in a product
 * name or an order number are never treated as a budget. Later explicit
 * budgets/sizes replace earlier ones within the current shopping session.
 */
export function extractProductPreferences(
  messages: ChatMessage[]
): ProductPreferences {
  const preferences: ProductPreferences = {};
  for (const message of shoppingUserMessages(messages)) {
    const text = message.content;
    if (/\b(no budget|any budget|no price limit)\b/i.test(text)) {
      delete preferences.minPrice;
      delete preferences.maxPrice;
      delete preferences.minExclusive;
      delete preferences.maxExclusive;
      delete preferences.currency;
      delete preferences.ambiguousCurrency;
    }
    const range = text.match(
      new RegExp(`\\bbetween\\s+(${AMOUNT})\\s+(?:and|to)\\s+(${AMOUNT})`, 'i')
    );
    const upper = text.match(
      new RegExp(
        `\\b(under|below|less than|up to|at most|max(?:imum)?(?: budget)?|budget(?: is| of)?(?: up to)?)\\s*:?\\s*(${AMOUNT})`,
        'i'
      )
    );
    const lower = text.match(
      new RegExp(
        `\\b(over|above|more than|at least|min(?:imum)?)\\s*:?\\s*(${AMOUNT})`,
        'i'
      )
    );
    const standalone = text.trim().match(new RegExp(`^(${AMOUNT})[.!]?$`, 'i'));
    // A bare numeric follow-up is a budget only when the assistant asked it.
    const index = messages.indexOf(message);
    const prior = messages
      .slice(0, index)
      .findLast((turn) => turn.role === 'assistant');
    const standaloneIsBudget =
      standalone &&
      (new RegExp(CURRENCY, 'i').test(standalone[1]) ||
        /\b(budget|spend|price range)\b/i.test(prior?.content ?? ''));
    if (range || upper || lower || standaloneIsBudget) {
      const previousCurrency = preferences.currency;
      delete preferences.minPrice;
      delete preferences.maxPrice;
      delete preferences.minExclusive;
      delete preferences.maxExclusive;
      delete preferences.currency;
      delete preferences.ambiguousCurrency;
      const amounts = range
        ? [money(range[1]), money(range[2])]
        : upper && lower
          ? [money(lower[2]), money(upper[2])]
          : [money((upper ?? lower)?.[2] ?? standalone![1])];
      preferences.currency =
        amounts.find((amount) => amount.currency)?.currency ?? previousCurrency;
      preferences.ambiguousCurrency =
        amounts.some((amount) => amount.ambiguousCurrency) ||
        new Set(amounts.map((amount) => amount.currency).filter(Boolean)).size >
          1;
      if (range) {
        preferences.minPrice = amounts[0].value;
        preferences.maxPrice = amounts[1].value;
      } else if (upper && lower) {
        preferences.minPrice = amounts[0].value;
        preferences.maxPrice = amounts[1].value;
        preferences.minExclusive = /over|above|more than/i.test(lower[1]);
        preferences.maxExclusive = /under|below|less than/i.test(upper[1]);
      } else if (lower) {
        preferences.minPrice = amounts[0].value;
        preferences.minExclusive = /over|above|more than/i.test(lower[1]);
      } else {
        preferences.maxPrice = amounts[0].value;
        preferences.maxExclusive =
          !!upper && /under|below|less than/i.test(upper[1]);
      }
    }
    if (
      new RegExp(`^${CURRENCY_CODE}[.!]?$`, 'i').test(text.trim()) &&
      (preferences.minPrice != null || preferences.maxPrice != null)
    ) {
      preferences.currency = text.trim().replace(/[.!]$/, '').toUpperCase();
      preferences.ambiguousCurrency = false;
    }
    const sizes = [
      ...text.matchAll(
        new RegExp(`\\b(?:size|in)\\s*:?\\s*(${SIZE})\\b(?![.\\d])`, 'gi')
      ),
    ];
    const standaloneSize = text
      .trim()
      .match(new RegExp(`^(${SIZE})[.!]?$`, 'i'));
    if (/\bany size\b/i.test(text)) {
      delete preferences.size;
      delete preferences.unsupportedSize;
    } else if (sizes.length) {
      preferences.size = normalizeProductSize(sizes.at(-1)![1]);
      delete preferences.unsupportedSize;
    } else if (standaloneSize && /\bsize\b/i.test(prior?.content ?? '')) {
      preferences.size = normalizeProductSize(standaloneSize[1]);
      delete preferences.unsupportedSize;
    } else if (
      /\bsize\s*:?\s+\S+/i.test(text) &&
      !/\bsize (guide|chart|options)\b/i.test(text)
    )
      preferences.unsupportedSize = true;
  }
  return preferences;
}

export function productMatchesPreferences(
  product: ShopifyCatalogProduct,
  preferences: ProductPreferences
): boolean {
  if (
    !product.in_stock ||
    preferences.ambiguousCurrency ||
    preferences.unsupportedSize
  )
    return false;
  if (
    !/^\d+(?:\.\d+)?$/.test(product.price.trim()) ||
    !Number.isFinite(Number(product.price))
  )
    return false;
  if (preferences.minPrice != null && !Number.isFinite(preferences.minPrice))
    return false;
  if (preferences.maxPrice != null && !Number.isFinite(preferences.maxPrice))
    return false;
  if (
    preferences.currency &&
    product.currency?.toUpperCase() !== preferences.currency
  )
    return false;
  if (preferences.minPrice != null || preferences.maxPrice != null) {
    // An unmarked budget uses the store's catalog currency, never FX conversion.
    if (!product.currency || !/^\d+(?:\.\d+)?$/.test(product.price.trim()))
      return false;
    const price = Number(product.price);
    if (!Number.isFinite(price)) return false;
    if (
      preferences.minPrice != null &&
      (preferences.minExclusive
        ? price <= preferences.minPrice
        : price < preferences.minPrice)
    )
      return false;
    if (
      preferences.maxPrice != null &&
      (preferences.maxExclusive
        ? price >= preferences.maxPrice
        : price > preferences.maxPrice)
    )
      return false;
  }
  if (preferences.size) {
    const variant = product.variant_title ?? '';
    const parts = variant
      .toLowerCase()
      .split(/\s*[/,|]\s*|\s+-\s+/)
      .map(normalizeProductSize);
    if (!parts.includes(preferences.size)) return false;
  }
  return true;
}

/** Keep money/size syntax out of title search; filtering handles those fields. */
export function stripProductPreferenceTerms(
  text: string,
  stripStandaloneBudget = false
): string {
  const cleaned = text
    .replace(
      new RegExp(`\\bbetween\\s+${AMOUNT}\\s+(?:and|to)\\s+${AMOUNT}`, 'gi'),
      ' '
    )
    .replace(
      new RegExp(
        `\\b(?:under|below|less than|up to|at most|max(?:imum)?(?: budget)?|budget(?: is| of)?(?: up to)?|over|above|more than|at least|min(?:imum)?)\\s*:?\\s*${AMOUNT}`,
        'gi'
      ),
      ' '
    )
    .replace(new RegExp(`\\b(?:size|in)\\s*:?\\s*${SIZE}\\b`, 'gi'), ' ')
    .replace(new RegExp(`^\\s*${CURRENCY_CODE}[.!]?\\s*$`, 'i'), ' ');
  return stripStandaloneBudget
    ? cleaned.replace(new RegExp(`^\\s*${AMOUNT}[.!]?\\s*$`, 'i'), ' ')
    : cleaned;
}

export function formatProductPreferences(
  preferences: ProductPreferences
): string {
  return JSON.stringify(preferences);
}
