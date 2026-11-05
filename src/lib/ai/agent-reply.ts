import type { SupabaseClient } from '@supabase/supabase-js';
import type { ShopifyCatalogProduct } from '@/lib/shopify/product-store';
import type { AiConfig, AiUsage, ChatMessage } from './types';
import { shouldRefreshShopifyOrders } from './commerce-intent';
import { buildSystemPrompt } from './defaults';
import { generateReply } from './generate';
import { retrieveKnowledge } from './knowledge';
import { knowledgeSearchText } from './knowledge-query';
import {
  loadRecommendationStore,
  safeProductIntro,
  type RecommendationStore,
} from './product-delivery';
import {
  extractProductPreferences,
  formatProductPreferences,
} from './product-preferences';
import {
  buildProductSearchQuery,
  formatProductRecommendationsForAi,
  hasNamedCollectionRequest,
  isMoreProductsRequest,
  resolveRecommendedProducts,
  resolveRequestedCollection,
  shouldOfferProductCarousel,
} from './product-recommendations';
import { formatReplyGuidance, loadReplyGuidance } from './reply-guidance';
import { retrieveShopifyContext } from './shopify-context';
import { loadStoreProfile } from './store-profile';

export interface AgentReplyArgs {
  db: SupabaseClient;
  accountId: string;
  config: AiConfig;
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[];
  /**
   * The contact whose Shopify orders may be disclosed in the reply. Pass it
   * only when the channel has proved the customer owns that contact's phone
   * number (WhatsApp does, by construction). Omit it for an unverified
   * visitor: no order data is retrieved at all.
   */
  verifiedContactId?: string | null;
  /** Goal set by a flow's AI agent node, if one is steering this thread. */
  flowGoal?: string | null;
}

export interface AgentReply {
  /** Reply text, without channel-specific product details or handoff line. */
  text: string;
  handoff: boolean;
  quickReplies?: string[];
  usage: AiUsage | null;
  recommendedProducts: ShopifyCatalogProduct[];
  recommendationStore: RecommendationStore | null;
  /** The reply was written expecting products to be delivered as cards. */
  hasProductCards: boolean;
}

export type AgentReplyOutcome =
  | { status: 'generated'; reply: AgentReply }
  /** The provider call failed; the caller decides how to fail over. */
  | { status: 'generation_failed'; error: unknown };

/**
 * Decide what the agent says next: retrieve knowledge, orders, products and
 * brand guidance, build the prompt, and call the configured provider.
 *
 * Channel-neutral and side-effect free: it sends nothing, stores nothing and
 * logs no usage, so every channel gets the same answer and owns its own
 * eligibility checks and delivery.
 *
 * Throws if retrieval fails. A provider failure is returned instead, because
 * callers need to tell the two apart: auto-reply hands the customer to the
 * team only when the provider failed.
 */
export async function generateAgentReply(
  args: AgentReplyArgs
): Promise<AgentReplyOutcome> {
  const { db, accountId, config, messages, verifiedContactId, flowGoal } = args;

  const latestQuestion = knowledgeSearchText(messages);
  const wantsProductCarousel = shouldOfferProductCarousel(messages);
  const productSearchQuery = buildProductSearchQuery(messages);
  const productPreferences = extractProductPreferences(messages);

  const [
    knowledge,
    shopifyContext,
    recommendationStore,
    storeProfile,
    replyGuidance,
  ] = await Promise.all([
    retrieveKnowledge(db, accountId, config, latestQuestion),
    verifiedContactId
      ? retrieveShopifyContext(db, accountId, verifiedContactId, {
          refresh: shouldRefreshShopifyOrders(messages),
        })
      : Promise.resolve(null),
    wantsProductCarousel
      ? loadRecommendationStore(db, accountId)
      : Promise.resolve(null),
    loadStoreProfile(db, accountId),
    loadReplyGuidance(db, accountId, latestQuestion),
  ]);

  const collectionResult =
    wantsProductCarousel && recommendationStore
      ? await resolveRequestedCollection({
          db,
          accountId,
          messages,
          preferences: productPreferences,
        }).catch((error) => {
          console.warn(
            '[ai recommendations] collection lookup unavailable:',
            error
          );
          return null;
        })
      : null;

  const recommendedProducts = collectionResult
    ? collectionResult.products
    : hasNamedCollectionRequest(messages)
      ? []
      : wantsProductCarousel && recommendationStore
        ? await resolveRecommendedProducts(
            db,
            accountId,
            productSearchQuery,
            knowledge,
            undefined,
            productPreferences,
            new Set(
              isMoreProductsRequest(messages.at(-1)?.content ?? '')
                ? messages.flatMap((m) =>
                    m.role === 'assistant' ? (m.productVariantIds ?? []) : []
                  )
                : []
            )
          ).catch(() => [])
        : [];

  const hasProductCards =
    !!recommendationStore?.carouselEnabled && recommendedProducts.length > 0;
  const productRecommendations =
    recommendedProducts.length > 0
      ? formatProductRecommendationsForAi(recommendedProducts)
      : null;

  const systemPrompt = buildSystemPrompt({
    userPrompt: config.systemPrompt,
    mode: 'auto_reply',
    knowledge,
    shopifyContext,
    productRecommendations,
    productDelivery: hasProductCards ? 'carousel' : 'text',
    productPreferences: wantsProductCarousel
      ? formatProductPreferences(productPreferences)
      : undefined,
    productBrowseNoMatches:
      wantsProductCarousel && recommendedProducts.length === 0,
    collectionLookupUnavailable:
      hasNamedCollectionRequest(messages) && !collectionResult,
    productBrowseExhausted:
      !!collectionResult &&
      isMoreProductsRequest(messages.at(-1)?.content ?? '') &&
      recommendedProducts.length === 0,
    storeProfile,
    flowGoal,
    replyGuidance: formatReplyGuidance(replyGuidance),
  });

  let generated: Awaited<ReturnType<typeof generateReply>>;
  try {
    generated = await generateReply({ config, systemPrompt, messages });
  } catch (error) {
    return { status: 'generation_failed', error };
  }

  const { handoff, usage, quickReplies } = generated;
  const collectionUrl =
    collectionResult?.collection.handle &&
    /^[a-z0-9-]+$/i.test(collectionResult.collection.handle)
      ? `https://${recommendationStore!.shopDomain}/collections/${collectionResult.collection.handle}`
      : null;
  const intro =
    recommendedProducts.length > 0 && !handoff
      ? safeProductIntro(generated.text)
      : generated.text;
  const text =
    collectionUrl && recommendedProducts.length > 0 && !handoff
      ? `${intro}\n\nBrowse the collection: ${collectionUrl}`
      : intro;

  return {
    status: 'generated',
    reply: {
      text,
      handoff,
      ...(quickReplies ? { quickReplies } : {}),
      usage,
      recommendedProducts,
      recommendationStore,
      hasProductCards,
    },
  };
}
