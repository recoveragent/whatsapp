import type { SupabaseClient } from '@supabase/supabase-js';

import {
  getShopifyCatalogProduct,
  searchShopifyProducts,
  type ShopifyCatalogProduct,
} from '@/lib/shopify/product-store';

import type { ChatMessage } from './types';
import { latestUserMessage } from './query';

const PRODUCT_INTENT_PATTERN =
  /\b(recommend|suggestion|suggest|show\s+me|looking\s+for|browse|catalog|catalogue|products?|collection|buy|shop|purchase|what\s+do\s+you\s+have|do\s+you\s+have|any\s+.+\s+available|new\s+arrivals?|best\s+sellers?|gift|gifts|anniversary|birthday|present)\b/i;

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

  for (const raw of text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/)) {
    const word = raw.trim();
    if (word.length < 2 || SEARCH_STOP_WORDS.has(word) || seen.has(word)) continue;
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
  const userText = messages
    .filter((message) => message.role === 'user')
    .slice(-5)
    .map((message) => message.content)
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
  if (isProductRecommendationQuery(latest)) return true;

  const userMessages = messages.filter((message) => message.role === 'user');
  if (userMessages.length < 2) return false;

  const hadProductIntent = userMessages
    .slice(0, -1)
    .some((message) => isProductRecommendationQuery(message.content));
  if (!hadProductIntent) return false;

  // Short reply while already discussing gifts/products — keep browsing.
  if (latest.length <= 40) return true;

  return extractProductSearchTerms(latest).length > 0;
}

function carouselReady(
  products: ShopifyCatalogProduct[],
  limit: number,
): ShopifyCatalogProduct[] {
  return products
    .filter((product) => Boolean(product.image_url?.trim()))
    .slice(0, Math.min(Math.max(limit, 2), MAX_CAROUSEL_LIMIT));
}

/**
 * Search the synced Shopify catalog for carousel candidates. Tries
 * conversation terms first, then individual keywords. Only falls back to
 * the general catalogue for open-ended browse asks with no specific terms
 * (never substitutes a generic list when gift/occasion terms had no match).
 */
export async function searchRecommendedProducts(
  db: SupabaseClient,
  accountId: string,
  query: string,
  limit: number = aiProductCarouselLimit(),
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const minNeeded = MIN_CAROUSEL_LIMIT;
  const byVariant = new Map<number, ShopifyCatalogProduct>();

  const merge = (products: ShopifyCatalogProduct[]) => {
    for (const product of products) {
      if (!product.in_stock || !product.image_url?.trim()) continue;
      byVariant.set(product.shopify_variant_id, product);
    }
  };

  const terms = extractProductSearchTerms(query);

  if (terms.length > 0) {
    merge(
      await searchShopifyProducts({
        db,
        accountId,
        query: terms.join(' '),
        limit: max * 3,
        inStockOnly: true,
      }),
    );

    if (byVariant.size < minNeeded) {
      for (const term of terms) {
        if (byVariant.size >= max) break;
        merge(
          await searchShopifyProducts({
            db,
            accountId,
            query: term,
            limit: max,
            inStockOnly: true,
          }),
        );
      }
    }
  }

  // Open-ended "show me products" with no gift/occasion terms only.
  if (byVariant.size < minNeeded && terms.length === 0) {
    merge(
      await searchShopifyProducts({
        db,
        accountId,
        limit: max * 3,
        inStockOnly: true,
      }),
    );
  }

  return carouselReady([...byVariant.values()], max);
}

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
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const products: ShopifyCatalogProduct[] = [];

  for (const variantId of variantIds) {
    if (products.length >= max) break;
    const product = await getShopifyCatalogProduct({
      db,
      accountId,
      shopifyVariantId: variantId,
    });
    if (!product?.in_stock || !product.image_url?.trim()) continue;
    products.push(product);
  }

  return products;
}

/** Pull likely product-name lines from knowledge-base excerpts (bullets, numbered lists). */
export function extractProductHintsFromKnowledge(knowledge: string[]): string[] {
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
          line,
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
      limit: 2,
      inStockOnly: true,
    });
    for (const product of products) {
      if (!product.in_stock || !product.image_url?.trim()) continue;
      byVariant.set(product.shopify_variant_id, product);
    }
  }

  return carouselReady([...byVariant.values()], max);
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
): Promise<ShopifyCatalogProduct[]> {
  const max = Math.min(Math.max(limit, MIN_CAROUSEL_LIMIT), MAX_CAROUSEL_LIMIT);
  const variantIds = extractVariantIdsFromKnowledge(knowledge);

  if (variantIds.length > 0) {
    return carouselReady(
      await productsFromKnowledgeVariantIds(db, accountId, variantIds, max),
      max,
    );
  }

  const byVariant = new Map<number, ShopifyCatalogProduct>();

  const merge = (products: ShopifyCatalogProduct[]) => {
    for (const product of products) {
      if (!product.in_stock || !product.image_url?.trim()) continue;
      byVariant.set(product.shopify_variant_id, product);
    }
  };

  merge(await productsFromKnowledgeHints(db, accountId, knowledge, max));

  if (byVariant.size < MIN_CAROUSEL_LIMIT) {
    merge(await searchRecommendedProducts(db, accountId, query, max));
  }

  return carouselReady([...byVariant.values()], max);
}

/** Summarize matched catalog products for the AI prompt. */
export function formatProductRecommendationsForAi(
  products: ShopifyCatalogProduct[],
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
