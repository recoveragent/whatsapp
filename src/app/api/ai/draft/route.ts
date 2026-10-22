import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadAiConfig } from '@/lib/ai/config';
import { buildConversationContext } from '@/lib/ai/context';
import { retrieveKnowledge } from '@/lib/ai/knowledge';
import { generateReply } from '@/lib/ai/generate';
import { buildSystemPrompt } from '@/lib/ai/defaults';
import { knowledgeSearchText } from '@/lib/ai/knowledge-query';
import { shouldRefreshShopifyOrders } from '@/lib/ai/commerce-intent';
import {
  extractProductPreferences,
  formatProductPreferences,
} from '@/lib/ai/product-preferences';
import {
  appendRecommendationText,
  loadRecommendationStore,
} from '@/lib/ai/product-delivery';
import {
  buildProductSearchQuery,
  formatProductRecommendationsForAi,
  resolveRecommendedProducts,
  shouldOfferProductCarousel,
} from '@/lib/ai/product-recommendations';
import { retrieveShopifyContext } from '@/lib/ai/shopify-context';
import { logAiUsage } from '@/lib/ai/usage';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { AiError } from '@/lib/ai/types';

/**
 * POST /api/ai/draft  (agent+)
 *
 * Body: { conversation_id }
 * Returns: { draft } — a suggested reply for the agent to edit + send.
 *
 * Uses the account's configured provider/key (BYO). Read-only: it never
 * sends or stores anything, just hands text back to the composer.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('agent');

    const userLimit = checkRateLimit(`ai-draft:${userId}`, RATE_LIMITS.aiDraft);
    if (!userLimit.success) return rateLimitResponse(userLimit);
    // Also cap the whole team's draws on the shared BYO provider key.
    const accountLimit = checkRateLimit(
      `ai-draft-acct:${accountId}`,
      RATE_LIMITS.aiDraftAccount
    );
    if (!accountLimit.success) return rateLimitResponse(accountLimit);

    const body = await request.json().catch(() => null);
    const conversationId =
      body && typeof body.conversation_id === 'string'
        ? body.conversation_id
        : '';
    if (!conversationId) {
      return NextResponse.json(
        { error: 'conversation_id is required' },
        { status: 400 }
      );
    }

    // RLS scopes the SSR client to the caller's account, so a missing
    // row means "not yours / not found" either way.
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversationId)
      .maybeSingle();
    if (convErr) {
      console.error('[ai/draft] conversation lookup error:', convErr);
      return NextResponse.json(
        { error: 'Failed to load conversation' },
        { status: 500 }
      );
    }
    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      );
    }

    const config = await loadAiConfig(supabase, accountId).catch((err) => {
      // Decrypt failure — surface distinctly from "not configured".
      console.error('[ai/draft] loadAiConfig error:', err);
      throw new AiError('Stored API key could not be decrypted.', {
        code: 'key_decrypt_failed',
        status: 400,
      });
    });
    if (!config) {
      return NextResponse.json(
        {
          error:
            'Ask super admin to configure the AI model, then enable the assistant in AI Agents → Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const messages = await buildConversationContext(supabase, conversationId);
    // Nothing to draft from — a brand-new thread with no customer text
    // would otherwise produce a nonsensical reply-to-nothing.
    if (messages.length === 0) {
      return NextResponse.json(
        {
          error: 'No messages to draft from yet.',
          code: 'no_messages',
        },
        { status: 400 }
      );
    }

    const latestQuestion = knowledgeSearchText(messages);
    const wantsProducts = shouldOfferProductCarousel(messages);
    const productPreferences = extractProductPreferences(messages);

    const [knowledge, shopifyContext, recommendationStore] = await Promise.all([
      retrieveKnowledge(supabase, accountId, config, latestQuestion),
      conversation.contact_id
        ? retrieveShopifyContext(supabase, accountId, conversation.contact_id, {
            refresh: shouldRefreshShopifyOrders(messages),
          })
        : Promise.resolve(null),
      wantsProducts
        ? loadRecommendationStore(supabase, accountId)
        : Promise.resolve(null),
    ]);
    const recommendedProducts =
      wantsProducts && recommendationStore
        ? await resolveRecommendedProducts(
            supabase,
            accountId,
            buildProductSearchQuery(messages),
            knowledge,
            undefined,
            productPreferences
          ).catch(() => [])
        : [];

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'draft',
      knowledge,
      shopifyContext,
      productRecommendations: recommendedProducts.length
        ? formatProductRecommendationsForAi(recommendedProducts)
        : null,
      productDelivery: 'text',
      productPreferences: wantsProducts
        ? formatProductPreferences(productPreferences)
        : undefined,
      productBrowseNoMatches: wantsProducts && !recommendedProducts.length,
    });

    const { text, handoff, usage } = await generateReply({
      config,
      systemPrompt,
      messages,
    });

    // Record spend on the account's BYO key. Best-effort + via the
    // service role (the log has no `authenticated` INSERT policy). This
    // must not fail or delay the draft the agent is waiting on, so:
    //  - the whole thing is wrapped (constructing the admin client throws
    //    if the service-role key is unset — that must not 500 the draft);
    //  - it's fire-and-forget (`void`), not awaited, so the response
    //    isn't held for a DB round-trip.
    try {
      void logAiUsage(supabaseAdmin(), {
        accountId,
        conversationId,
        mode: 'draft',
        provider: config.provider,
        model: config.model,
        usage,
      });
    } catch (logErr) {
      console.error('[ai/draft] usage log skipped:', logErr);
    }

    return NextResponse.json({
      draft: handoff
        ? text
        : appendRecommendationText(
            text,
            recommendedProducts,
            recommendationStore
          ),
    });
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status }
      );
    }
    return toErrorResponse(err);
  }
}
