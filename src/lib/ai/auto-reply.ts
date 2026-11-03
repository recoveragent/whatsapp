import type { SupabaseClient } from '@supabase/supabase-js';
import {
  fetchAccountWithCategory,
  isMissingColumnError,
} from '@/lib/auth/brand-accounts';
import { AiError, type AiConfig, type ChatMessage } from './types';
import { loadStoreProfile } from './store-profile';
import { supabaseAdmin } from './admin-client';
import { loadAiConfig } from './config';
import { buildConversationContext } from './context';
import { retrieveKnowledge } from './knowledge';
import { retrieveShopifyContext } from './shopify-context';
import {
  buildProductSearchQuery,
  formatProductRecommendationsForAi,
  resolveRecommendedProducts,
  resolveRequestedCollection,
  isMoreProductsRequest,
  hasNamedCollectionRequest,
  shouldOfferProductCarousel,
} from './product-recommendations';
import { sendShopifyProductCard } from '@/lib/shopify/send-product-card';
import { sendShopifyProductCarousel } from '@/lib/shopify/send-product-carousel';
import {
  ProductCarouselAlreadySentError,
  ProductCarouselDeliveryUncertainError,
} from '@/lib/shopify/product-delivery-error';
import { generateReply } from './generate';
import { buildSystemPrompt, handoffReplyText } from './defaults';
import { buildHandoffSummary } from './handoff';
import { logAiUsage } from './usage';
import { knowledgeSearchText } from './knowledge-query';
import { shouldRefreshShopifyOrders } from './commerce-intent';
import { latestUserMessage } from './query';
import {
  extractProductPreferences,
  formatProductPreferences,
} from './product-preferences';
import {
  appendRecommendationText,
  canDeliverProductCarousel,
  loadRecommendationStore,
} from './product-delivery';
import {
  engineSendText,
  engineSendInteractiveButtons,
} from '@/lib/flows/meta-send';
import { replyButtonsForMessage } from './quick-replies';
import { formatReplyGuidance, loadReplyGuidance } from './reply-guidance';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';

interface DispatchArgs {
  /** Tenancy key — drives config, contact, and whatsapp_config lookups. */
  accountId: string;
  conversationId: string;
  contactId: string;
  /** The account's WhatsApp config owner, used for the outbound send's
   *  audit columns (mirrors how the flow runner passes it through). */
  configOwnerUserId: string;
}

/**
 * AI auto-reply for a freshly-arrived inbound message.
 *
 * Invoked from the WhatsApp webhook's `after()` block, only when no
 * deterministic flow consumed the message (flows win). Mirrors the flow
 * runner's contract: it owns its try/catch and NEVER throws — a failing
 * or slow LLM call must not affect the webhook's 200 to Meta.
 *
 * Eligibility gates (any → silent no-op):
 *   - AI off / auto-reply disabled for the account
 *   - a human agent is assigned (they own the thread)
 *   - auto-reply was disabled for this conversation (prior handoff)
 *   - the per-conversation reply cap is reached
 *   - there's nothing to reply to
 *
 * The 24h WhatsApp session window is inherently open here — we're
 * reacting to a customer message that just landed — so no separate
 * window check is needed.
 */
export async function dispatchInboundToAiReply(
  args: DispatchArgs
): Promise<void> {
  const { accountId, conversationId, contactId, configOwnerUserId } = args;

  try {
    const db = supabaseAdmin();

    const account = await fetchAccountWithCategory(db, accountId);
    if (!account?.ai_agents_enabled) return;

    const config = await loadAiConfig(db, accountId);
    if (!config || !config.autoReplyEnabled) return;

    // Deterministic, user-configured responders win over the LLM. The
    // webhook only calls this when no Flow consumed the message and no
    // message-level automation (`new_message_received`, or a
    // `keyword_match` whose keyword matched) ran for it. An unrelated
    // keyword automation no longer silences the agent account-wide.

    const conv = await loadConversationState(db, conversationId);
    if (!conv) return;
    if (conv.assigned_agent_id) return; // a human owns this thread
    // Cheap early-out; the authoritative cap check is the atomic claim
    // below (this read can race a concurrent inbound).
    if (conv.ai_reply_count >= config.autoReplyMaxPerConversation) return;

    const messages = await buildConversationContext(db, conversationId);
    if (messages.length === 0) return;

    // Handed off / turned off here — unless the customer has moved on to a
    // new shopping request after a handoff nobody has picked up yet.
    if (
      conv.ai_autoreply_disabled &&
      !(await resumeAfterHandoffForNewTopic(db, conversationId, conv, messages))
    )
      return;

    // Account-wide throttle on the shared BYO key. The per-conversation
    // cap bounds one thread; this bounds a burst across many threads (a
    // marketing blast landing 200 replies at once) so we never run the
    // owner's key past the provider's rate limit. Over the limit → skip
    // the auto-reply; the inbound still sits in the inbox for a human.
    const acctLimit = checkRateLimit(
      `ai-autoreply:${accountId}`,
      RATE_LIMITS.aiAutoReplyAccount
    );
    if (!acctLimit.success) {
      console.warn(
        `[ai auto-reply] account ${accountId} hit the per-account rate limit — skipping this inbound.`
      );
      return;
    }

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
      retrieveShopifyContext(db, accountId, contactId, {
        refresh: shouldRefreshShopifyOrders(messages),
      }),
      wantsProductCarousel
        ? loadRecommendationStore(db, accountId)
        : Promise.resolve(null),
      loadStoreProfile(db, accountId),
      loadReplyGuidance(db, accountId, latestQuestion),
    ]);

    const collectionResult =
      wantsProductCarousel && recommendationStore
        ? await resolveRequestedCollection({
            db: db,
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

    const hasCarouselProducts = canDeliverProductCarousel(
      recommendedProducts,
      recommendationStore
    );
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
      flowGoal: conv.ai_flow_goal,
      replyGuidance: formatReplyGuidance(replyGuidance),
    });

    let generated: Awaited<ReturnType<typeof generateReply>>;
    try {
      generated = await generateReply({ config, systemPrompt, messages });
    } catch (genErr) {
      // A provider failure (bad key, quota, outage, empty output after
      // the retry) used to end here with only a log line, leaving the
      // customer unanswered. Hand the thread to the team instead.
      console.error('[ai auto-reply] generation failed, handing off:', genErr);
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        conv,
        messages,
        failureReason: describeFailure(genErr),
      });
      return;
    }
    const { handoff, usage } = generated;
    const collectionUrl =
      collectionResult?.collection.handle &&
      /^[a-z0-9-]+$/i.test(collectionResult.collection.handle)
        ? `https://${recommendationStore!.shopDomain}/collections/${collectionResult.collection.handle}`
        : null;
    const text =
      collectionUrl && recommendedProducts.length > 0
        ? `${generated.text}\n\nBrowse the collection: ${collectionUrl}`
        : generated.text;

    // Record token spend on the account's BYO key. Fire-and-forget so it
    // never adds latency to the customer-facing send: `logAiUsage`
    // swallows its own errors, so the floating promise can't reject.
    // Logged regardless of handoff — the provider call happened either
    // way.
    void logAiUsage(db, {
      accountId,
      conversationId,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    });

    if (handoff || !text) {
      await handOffToHuman({
        db,
        accountId,
        conversationId,
        contactId,
        configOwnerUserId,
        config,
        conv,
        messages,
        agentText: text,
      });
      return;
    }

    // Atomically claim a reply slot: the cap check + increment happen in
    // one UPDATE, so concurrent inbounds can never overshoot the cap. If
    // another inbound just took the last slot, `claimed` is false and we
    // skip the send. (We consume a slot slightly before the send lands —
    // fail-safe: under-reply rather than over-reply.)
    const { data: claimed, error: claimErr } = await db.rpc(
      'claim_ai_reply_slot',
      {
        conversation_id: conversationId,
        max_replies: config.autoReplyMaxPerConversation,
      }
    );
    if (claimErr) {
      // A real error here (vs. losing the cap race) is almost always a
      // deploy issue — e.g. `claim_ai_reply_slot` not EXECUTE-able by the
      // service role, or the migration not applied. Log it loudly: a
      // silent return makes "auto-reply never fires" undiagnosable.
      console.error('[ai auto-reply] claim_ai_reply_slot failed:', claimErr);
      return;
    }
    if (claimed !== true) return; // lost the per-conversation cap race

    if (hasCarouselProducts) {
      try {
        await sendShopifyProductCarousel({
          db,
          accountId,
          userId: configOwnerUserId,
          conversationId,
          contactId,
          bodyText: text,
          shopifyVariantIds: recommendedProducts.map(
            (product) => product.shopify_variant_id
          ),
          linkTarget: 'product_page',
          skipAssigneeCheck: true,
          aiGenerated: true,
        });
        return;
      } catch (carouselErr) {
        if (carouselErr instanceof ProductCarouselAlreadySentError) {
          console.error(
            '[ai auto-reply] carousel accepted by Meta but not persisted:',
            carouselErr
          );
          return;
        }
        if (carouselErr instanceof ProductCarouselDeliveryUncertainError) {
          console.error(
            '[ai auto-reply] carousel delivery uncertain; skipping duplicate fallback:',
            carouselErr
          );
          return;
        }
        console.warn(
          '[ai auto-reply] product carousel failed; trying product cards:',
          carouselErr
        );
      }
    }

    if (hasProductCards) {
      for (const [index, product] of recommendedProducts.entries()) {
        try {
          await sendShopifyProductCard({
            db,
            accountId,
            userId: configOwnerUserId,
            conversationId,
            shopifyVariantId: product.shopify_variant_id,
            introText: index === 0 ? text : undefined,
            linkTarget: 'product_page',
            skipAssigneeCheck: true,
            aiGenerated: true,
          });
        } catch (error) {
          // A failed request may already have reached Meta. Do not retry or
          // send text links, which could duplicate the customer's message.
          console.error('[ai auto-reply] product card delivery failed:', error);
          return;
        }
      }
      return;
    }

    const replyText = appendRecommendationText(
      text,
      recommendedProducts,
      recommendationStore
    );
    const quickReplies = replyButtonsForMessage(
      replyText,
      generated.quickReplies
    );
    if (quickReplies.length) {
      await engineSendInteractiveButtons({
        accountId,
        userId: configOwnerUserId,
        conversationId,
        contactId,
        bodyText: replyText,
        buttons: quickReplies.map((title, index) => ({
          id: `ai_reply_${index + 1}`,
          title,
        })),
        aiGenerated: true,
      });
      return;
    }

    await engineSendText({
      accountId,
      userId: configOwnerUserId,
      conversationId,
      contactId,
      text: replyText,
      aiGenerated: true,
    });
  } catch (err) {
    console.error('[ai auto-reply] dispatch failed:', err);
  }
}

interface ConversationState {
  assigned_agent_id: string | null;
  ai_autoreply_disabled: boolean;
  ai_reply_count: number;
  ai_flow_goal: string | null;
  /** Set only by a bot handoff; a manual pause leaves it empty. */
  ai_handoff_summary: string | null;
}

async function loadConversationState(
  db: SupabaseClient,
  conversationId: string
): Promise<ConversationState | null> {
  const base =
    'assigned_agent_id, ai_autoreply_disabled, ai_reply_count, ai_handoff_summary';
  let { data, error } = await db
    .from('conversations')
    .select(`${base}, ai_flow_goal`)
    .eq('id', conversationId)
    .maybeSingle();
  // Tolerate code shipping ahead of migration 20261022090000.
  if (isMissingColumnError(error, 'ai_flow_goal')) {
    ({ data, error } = await db
      .from('conversations')
      .select(base)
      .eq('id', conversationId)
      .maybeSingle());
  }
  if (error || !data) return null;
  return {
    assigned_agent_id: data.assigned_agent_id ?? null,
    ai_autoreply_disabled: !!data.ai_autoreply_disabled,
    ai_reply_count: data.ai_reply_count ?? 0,
    ai_flow_goal:
      'ai_flow_goal' in data
        ? ((data.ai_flow_goal as string | null) ?? null)
        : null,
    ai_handoff_summary: data.ai_handoff_summary ?? null,
  };
}

/**
 * After a bot handoff the agent stays paused until someone resumes it. If
 * the customer then starts a new shopping request ("want to buy a birth
 * frame") and no one from the team has replied since the handoff, the
 * handed-off issue is not what they are asking about: resume the agent so
 * the request isn't left waiting. A manual pause (no handoff note), a team
 * reply, or a message that is still support/human-related stays paused.
 */
async function resumeAfterHandoffForNewTopic(
  db: SupabaseClient,
  conversationId: string,
  conv: ConversationState,
  messages: ChatMessage[]
): Promise<boolean> {
  if (!conv.ai_handoff_summary) return false;
  const latest = latestUserMessage(messages);
  if (!shouldOfferProductCarousel([{ role: 'user', content: latest }]))
    return false;

  // Walk back from the newest outbound message: a team reply before the
  // agent's own handoff message means a person has picked the thread up.
  const { data: outbound, error } = await db
    .from('messages')
    .select('sender_type, ai_generated')
    .eq('conversation_id', conversationId)
    .in('sender_type', ['agent', 'bot'])
    .order('created_at', { ascending: false })
    .limit(30);
  if (error || !outbound) return false;
  const lastActor = outbound.find(
    (m) => m.sender_type === 'agent' || m.ai_generated
  );
  if (!lastActor || lastActor.sender_type === 'agent') return false;

  // Only resume a thread that is still paused and unowned (a teammate may
  // have just picked it up, or a concurrent inbound resumed it).
  const { data: resumed, error: upErr } = await db
    .from('conversations')
    .update({ ai_autoreply_disabled: false, ai_handoff_summary: null })
    .eq('id', conversationId)
    .eq('ai_autoreply_disabled', true)
    .is('assigned_agent_id', null)
    .select('id');
  if (upErr) {
    console.error('[ai auto-reply] resume after handoff failed:', upErr);
    return false;
  }
  return (resumed?.length ?? 0) > 0;
}

/**
 * Stop auto-replying on this thread and give it to a human:
 *   (a) pause the bot here (sticky until re-enabled) and clear any flow goal,
 *   (b) route the conversation to the configured handoff agent — null
 *       leaves it in the shared queue; never stomps an existing owner,
 *   (c) leave a short internal note so whoever picks it up has context,
 *   (d) tell the customer a person is coming — after any useful reply the
 *       agent wrote — so their message never sits unanswered.
 * Assigning fires the `on_conversation_assigned` trigger, which notifies
 * the agent.
 */
async function handOffToHuman(args: {
  db: SupabaseClient;
  accountId: string;
  conversationId: string;
  contactId: string;
  configOwnerUserId: string;
  config: AiConfig;
  conv: ConversationState;
  messages: ChatMessage[];
  failureReason?: string;
  /** The agent's own reply written alongside the handoff, sent first. */
  agentText?: string;
}): Promise<void> {
  const { db, conversationId, config, conv } = args;
  const update: Record<string, unknown> = {
    ai_autoreply_disabled: true,
    ai_handoff_summary: buildHandoffSummary({
      messages: args.messages,
      replyCount: conv.ai_reply_count,
      failureReason: args.failureReason,
    }),
  };
  if (conv.ai_flow_goal) update.ai_flow_goal = null;
  if (config.handoffAgentId && !conv.assigned_agent_id) {
    update.assigned_agent_id = config.handoffAgentId;
  }
  const { error } = await db
    .from('conversations')
    .update(update)
    .eq('id', conversationId);
  if (error) {
    // Without the pause flag the next inbound would hand off (and message
    // the customer) again, so don't send.
    console.error('[ai auto-reply] handoff update failed:', error);
    return;
  }

  try {
    await engineSendText({
      accountId: args.accountId,
      userId: args.configOwnerUserId,
      conversationId,
      contactId: args.contactId,
      text: handoffReplyText(args.agentText ?? '', config.handoffMessage),
      aiGenerated: true,
    });
  } catch (sendErr) {
    console.error('[ai auto-reply] handoff message failed to send:', sendErr);
  }
}

function describeFailure(err: unknown): string {
  const code = err instanceof AiError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_key':
      return 'the AI provider rejected the API key';
    case 'rate_limited':
      return 'the AI provider rate-limited the request';
    case 'timeout':
      return 'the AI provider timed out';
    case 'empty_response':
      return 'the AI model returned an empty reply';
    default:
      return 'the AI provider returned an error';
  }
}
