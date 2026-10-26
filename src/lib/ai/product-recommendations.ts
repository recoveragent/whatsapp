import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getShopifyCatalogProduct,
  searchShopifyProducts,
  type ShopifyCatalogProduct,
} from '@/lib/shopify/product-store';

import type { ChatMessage } from './types';
import { latestUserMessage } from './query';
import { isOrderSupportQuery, isHumanSupportQuery } from './commerce-intent';
import {
  extractProductPreferences,
  productMatchesPreferences,
  shoppingUserMessages,
  stripProductPreferenceTerms,
  type ProductPreferences,
} from './product-preferences';

const PRODUCT_INTENT_PATTERN =
  /\b(recommend|suggestion|suggest|show(?:\s+me)?|looking\s+for|browse|catalog|catalogue|products?|collection|buy|shop|purchase|what\s+do\s+you\s+have|do\s+you\s+have|any\s+.+\s+available|new\s+arrivals?|best\s+sellers?|gift|gifts|anniversary|birthday|present|in\s+stock|do\s+you\s+sell)\b/i;

/** Stripped from catalog search — keep meaningful product/gift terms only. */
const SEARCH_STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'i',
  'me',
  'my',
  'we',
  'you',
  'your',
  'show',
  'see',
  'want',
  'to',
  'for',
  'some',
  'any',
  'please',
  'can',
  'could',
  'would',
  'what',
  'which',
  'how',
  'do',
  'does',
  'have',
  'has',
  'is',
  'are',
  'am',
  'be',
  'buy',
  'shop',
  'purchase',
  'browse',
  'catalog',
  'catalogue',
  'products',
  'product',
  'items',
  'item',
  'recommend',
  'recommendation',
  'suggest',
  'suggestion',
  'something',
  'options',
  'in',
  'and',
  'actually',
  'option',
  'looking',
  'need',
  'get',
  'give',
  'tell',
  'about',
  'from',
  'with',
  'few',
  'here',
  'options',
  // Pronouns and filler that otherwise match title prefixes ("he" → "Heart").
  'he',
  'she',
  'his',
  'they',
  'them',
  'it',
  'doesn',
  'don',
  'dont',
  'like',
  'likes',
  'who',
  'very',
  'really',
  'pls',
  'plz',
  'best',
  'selling',
  'seller',
  'sellers',
  'bestseller',
  'bestsellers',
]);

const DEFAULT_CAROUSEL_LIMIT = 4;
const MIN_CAROUSEL_LIMIT = 2;
const MAX_CAROUSEL_LIMIT = 4;

export function aiProductCarouselLimit(): number {
  const raw = Number(process.env.AI_PRODUCT_CAROUSEL_LIMIT);
  if (Number.isFinite(raw) && raw >= MIN_CAROUSEL_LIMIT) {
    return Math.min(Math.floor(raw), MAX_CAROUSEL_LIMIT);
  }
  return DEFAULT_CAROUSEL_LIMIT;
}

/** True when the customer message looks like a product browse / recommend ask. */
export function isProductRecommendationQuery(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return PRODUCT_INTENT_PATTERN.test(trimmed);
}

/** Meaningful tokens for catalog title search (stop words removed). */
export function extractProductSearchTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  for (const raw of text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)) {
    const word = raw.trim();
    if (word.length < 2 || SEARCH_STOP_WORDS.has(word) || seen.has(word))
      continue;
    seen.add(word);
    terms.push(word);
  }

  return terms;
}

/**
 * Build a catalog search string from recent customer turns. Strips filler
 * like "show me products" and keeps gift/recipient terms from earlier
 * messages in the same thread.
 */
export function buildProductSearchQuery(messages: ChatMessage[]): string {
  const preferences = extractProductPreferences(messages);
  const userText = shoppingUserMessages(messages)
    .slice(-5)
    .map((message) => {
      const text = stripProductPreferenceTerms(
        message.content,
        preferences.minPrice != null || preferences.maxPrice != null
      );
      if (
        preferences.size &&
        /^(?:xs|s|m|l|xl|xxl|small|medium|large)[.!]?$/i.test(text.trim())
      )
        return '';
      return text;
    })
    .join(' ');

  return extractProductSearchTerms(userText).join(' ');
}

/**
 * True when we should attach/send a product carousel — explicit product
 * intent on the latest turn, or a short follow-up in an active browse
 * thread (e.g. "wife" then "show me").
 */
export function shouldOfferProductCarousel(messages: ChatMessage[]): boolean {
  const latest = latestUserMessage(messages).trim();
  if (!latest) return false;
  if (/\b(?:size|sizing) (?:guide|chart)\b/i.test(latest)) return false;
  if (isHumanSupportQuery(latest)) return false;
  // An explicit browse request can mention delivery ("show me gifts with
  // delivery"), but support asks such as "return this product" must win.
  if (
    isOrderSupportQuery(latest) &&
    !/\b(recommend|suggest|show me|looking for|browse|buy)\b/i.test(latest)
  )
    return false;
  if (/\b(cancel|refund|damaged|broken|wrong item)\b/i.test(latest))
    return false;
  if (isProductRecommendationQuery(latest)) return true;

  const userMessages = messages.filter((message) => message.role === 'user');
  if (userMessages.length < 2) return false;

  const previousMessages = userMessages.slice(0, -1);
  const lastSupportIndex = previousMessages.findLastIndex(
    (message) =>
      isOrderSupportQuery(message.content) ||
      isHumanSupportQuery(message.content)
  );
  const hadProductIntent = previousMessages
    .slice(lastSupportIndex + 1)
    .some((message) => isProductRecommendationQuery(message.content));
  if (!hadProductIntent) return false;

  // Short reply while already discussing gifts/products — keep browsing.
  if (latest.length <= 40) return true;

  return extractProductSearchTerms(latest).length > 0;
}

function carouselReady(
  products: ShopifyCatalogProduct[],
  limit: number,
  preferences: ProductPreferences = {}
): ShopifyCatalogProduct[] {
  // One card per product: two sizes of the same frame read as a repeat,
  // not as a choice. Stores also list colours or designs as separate
  // products ("Men's Wallet - Olive Green"), so collapse those by the
  // title before " - " too.
  const seenProducts = new Set<number>();
  const seenTitles = new Set<string>();
  return products
    .filter((product) => {
      if (!productMatchesPreferences(product, preferences)) return false;
      const baseTitle = product.title.split(' - ')[0].trim().toLowerCase();
      if (seenProducts.has(product.shopify_product_id)) return false;
      if (seenTitles.has(baseTitle)) return false;
      seenProducts.add(product.shopify_product_id);
      seenTitles.add(baseTitle);
      return true;
    })
    .slice(0, Math.min(Math.max(limit, 2), MAX_CAROUSEL_LIMIT));
}

/** Words that appear in many gift titles and say little about fit. */
const GENERIC_TERMS = new Set([
  'gift',
  'gifts',
  'personalised',
  'personalized',
  'customised',
  'customized',
  'custom',
  'photo',
]);

/**
 * Recipient / interest words mapped to catalogue vocabulary. Customers
 * say "dad" or "coffee"; titles say "Men's Wallet" or "Mug".
 */
const RELATED_TERMS: Record<string, string[]> = {
  wife: ['couple', 'love', 'heart', 'women'],
  husband: ['couple', 'love', 'heart', 'men'],
  gf: ['couple', 'love', 'heart', 'women'],
  girlfriend: ['couple', 'love', 'heart', 'women'],
  bf: ['couple', 'love', 'heart', 'men'],
  boyfriend: ['couple', 'love', 'heart', 'men'],
  anniversary: ['couple', 'love', 'wedding'],
  valentine: ['couple', 'love', 'heart'],
  wedding: ['couple', 'anniversary'],
  dad: ['men'],
  father: ['men'],
  papa: ['men'],
  him: ['men'],
  brother: ['bro', 'men'],
  bro: ['brother', 'men'],
  bhai: ['brother', 'bro', 'men'],
  sister: ['sis', 'women'],
  sis: ['sister', 'women'],
  didi: ['sister', 'sis', 'women'],
  rakhi: ['brother', 'bro', 'sister'],
  mom: ['women', 'family'],
  mother: ['women', 'family'],
  mummy: ['women', 'family'],
  maa: ['women', 'family'],
  her: ['women'],
  coffee: ['mug'],
  tea: ['mug'],
  newborn: ['baby'],
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "hoodies" → "hoodie", so a plural ask still finds singular titles. */
function singular(term: string): string {
  return term.length > 3 && term.endsWith('s') && !term.endsWith('ss')
    ? term.slice(0, -1)
    : term;
}

/** Search terms with weights: the customer's own words, then related catalogue words. */
export function weightedSearchTerms(terms: string[]): Map<string, number> {
  const weighted = new Map<string, number>();
  for (const term of terms.map(singular)) {
    // Two-letter words ("ok", "to") match too many titles by prefix;
    // keep only the ones we know map to catalogue words (gf, bf).
    if (term.length < 3 && !RELATED_TERMS[term]) continue;
    weighted.set(term, GENERIC_TERMS.has(term) ? 0.25 : 1);
  }
  for (const term of terms) {
    for (const related of RELATED_TERMS[term] ?? RELATED_TERMS[singular(term)] ?? []) {
      if (!weighted.has(related)) weighted.set(related, 0.75);
    }
  }
  return weighted;
}

/** How well a catalogue row's title matches the weighted terms (0 = no match). */
export function productMatchScore(
  product: Pick<ShopifyCatalogProduct, 'title' | 'variant_title'>,
  weighted: Map<string, number>
): number {
  const text = `${product.title} ${product.variant_title ?? ''}`.toLowerCase();
  let score = 0;
  for (const [term, weight] of weighted) {
    // Word-start match: "men" hits "Men's Wallet" but not "Women's".
    const wordStart = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegExp(term)}`, 'u');
    if (wordStart.test(text)) score += weight;
  }
  return score;
}

/**
 * Search the synced Shopify catalog for carousel candidates. Searches each
 * conversation term (plus related catalogue words), ranks rows by how many
 * terms their title matches, and keeps one variant per product. Only falls
 * back to the general catalogue for open-ended browse asks with no
 * specific terms (never substitutes a generic list when gift/occasion
 * terms had no match).
 */
export async function searchRecommendedProducts(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit: number = aiProductCarouselLimit(),
  preferences: ProductPreferences = {}
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const terms = extractProductSearchTerms(query);

  if (terms.length === 0) {
    // Open-ended "show me products" with no gift/occasion terms only.
    return carouselReady(
      await searchShopifyProducts({ db, accountId, limit: 50, inStockOnly: true }),
      max,
      preferences
    );
  }

  const weighted = weightedSearchTerms(terms);
  const searchTerms = [...weighted.keys()].slice(0, 12);
  const batches = await Promise.all(
    searchTerms.map((term) =>
      searchShopifyProducts({
        db,
        accountId,
        query: term,
        limit: 50,
        inStockOnly: true,
      })
    )
  );

  const byVariant = new Map<number, { product: ShopifyCatalogProduct; score: number }>();
  batches.forEach((batch, index) => {
    // Rows found by the customer's own words always qualify; rows found
    // only through a related word must actually match it as a word.
    const ownTerm = terms.map(singular).includes(searchTerms[index]);
    for (const product of batch) {
      if (byVariant.has(product.shopify_variant_id)) continue;
      if (!productMatchesPreferences(product, preferences)) continue;
      const score = productMatchScore(product, weighted);
      if (ownTerm || score > 0) {
        byVariant.set(product.shopify_variant_id, { product, score });
      }
    }
  });

  // When the customer named something specific ("dad", "hamper"), a row
  // that only shares a generic word like "gift" is not a recommendation —
  // better to show nothing and let the agent ask than to show a wedding
  // frame for a 7-year-old.
  const specific = terms.some((term) => !GENERIC_TERMS.has(singular(term)));
  const ranked = [...byVariant.values()]
    .filter((entry) => !specific || entry.score >= STRONG_MATCH_SCORE)
    .sort(
      (a, b) =>
        b.score - a.score || Number(a.product.price) - Number(b.product.price)
    )
    .map((entry) => entry.product);

  return carouselReady(ranked, max, preferences);
}

/** One specific word (or a related one) — more than a lone "gift". */
const STRONG_MATCH_SCORE = 0.5;

/** Shopify variant IDs from knowledge-base URLs (`?variant=123`). */
export function extractVariantIdsFromKnowledge(knowledge: string[]): number[] {
  const ids: number[] = [];
  const seen = new Set<number>();

  for (const chunk of knowledge) {
    for (const match of chunk.matchAll(/[?&]variant=(\d+)/gi)) {
      const id = Number(match[1]);
      if (!Number.isFinite(id) || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }

  return ids;
}

/** Load curated catalogue rows by Shopify variant id (KB URL lists). */
export async function productsFromKnowledgeVariantIds(
  db: SupabaseClient,
  accountId: string,
  variantIds: number[],
  limit: number = aiProductCarouselLimit(),
  preferences: ProductPreferences = {}
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const products = await Promise.all(
    variantIds
      .slice(0, 20)
      .map((variantId) =>
        getShopifyCatalogProduct({ db, accountId, shopifyVariantId: variantId })
      )
  );
  return products
    .filter(
      (product): product is ShopifyCatalogProduct =>
        !!product && productMatchesPreferences(product, preferences)
    )
    .slice(0, max);
}

/** Pull likely product-name lines from knowledge-base excerpts (bullets, numbered lists). */
export function extractProductHintsFromKnowledge(
  knowledge: string[]
): string[] {
  const hints: string[] = [];
  const seen = new Set<string>();

  for (const chunk of knowledge) {
    for (const rawLine of chunk.split('\n')) {
      const line = rawLine
        .replace(/^[-*•]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .trim();
      if (/^https?:\/\//i.test(line)) continue;
      if (line.length < 4 || line.length > 120) continue;
      // Skip policy/instruction lines — keep lines that look like product names.
      if (line.endsWith(':')) continue;
      if (
        /^(when|if|do not|never|only|use|note|tip|price|policy|always)\b/i.test(
          line
        )
      ) {
        continue;
      }
      if (/\brecommend these\b/i.test(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hints.push(line);
    }
  }

  return hints.slice(0, 12);
}

/** Match knowledge-base product name hints against the synced catalogue. */
export async function productsFromKnowledgeHints(
  db: SupabaseClient,
  accountId: string,
  knowledge: string[],
  limit: number = aiProductCarouselLimit(),
  preferences: ProductPreferences = {}
): Promise<ShopifyCatalogProduct[]> {
  const hints = extractProductHintsFromKnowledge(knowledge);
  if (hints.length === 0) return [];

  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const byVariant = new Map<number, ShopifyCatalogProduct>();

  for (const hint of hints) {
    if (byVariant.size >= max) break;
    const products = await searchShopifyProducts({
      db,
      accountId,
      query: hint,
      limit: 50,
      inStockOnly: true,
    });
    for (const product of products) {
      if (!productMatchesPreferences(product, preferences)) continue;
      byVariant.set(product.shopify_variant_id, product);
    }
  }

  return carouselReady([...byVariant.values()], max, preferences);
}

/**
 * Resolve carousel products: KB variant URLs first (exact designs), then
 * KB product-name hints, then catalogue keyword search from the conversation.
 */
export async function resolveRecommendedProducts(
  db: SupabaseClient,
  accountId: string,
  query: string,
  knowledge: string[] = [],
  limit: number = aiProductCarouselLimit(),
  preferences: ProductPreferences = {}
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const variantIds = extractVariantIdsFromKnowledge(knowledge);

  if (variantIds.length > 0) {
    return carouselReady(
      await productsFromKnowledgeVariantIds(
        db,
        accountId,
        variantIds,
        max,
        preferences
      ),
      max,
      preferences
    );
  }

  // Knowledge-base product names are a hint, not a curation: a policy or
  // FAQ line that happens to match a title must not crowd out products
  // that fit what the customer asked for.
  const [hinted, searched] = await Promise.all([
    productsFromKnowledgeHints(db, accountId, knowledge, max, preferences),
    searchRecommendedProducts(db, accountId, query, max, preferences),
  ]);
  const weighted = weightedSearchTerms(extractProductSearchTerms(query));
  const fittingHints = hinted.filter(
    (product) => productMatchScore(product, weighted) >= STRONG_MATCH_SCORE
  );

  return carouselReady(
    [...fittingHints, ...searched, ...(searched.length === 0 ? hinted : [])],
    max,
    preferences
  );
}

/** Summarize matched catalog products for the AI prompt. */
export function formatProductRecommendationsForAi(
  products: ShopifyCatalogProduct[]
): string {
  if (products.length === 0) return '';
  return products
    .map((product, index) => {
      const price =
        product.currency === 'INR'
          ? `₹${product.price}`
          : product.currency
            ? `${product.currency} ${product.price}`
            : product.price;
      return `[${index + 1}] ${product.title}${product.variant_title ? ` (${product.variant_title})` : ''} — ${price}`;
    })
    .join('\n');
}
