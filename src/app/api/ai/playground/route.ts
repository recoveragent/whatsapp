import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { generateAgentReply } from '@/lib/ai/agent-reply';
import { loadAiConfig } from '@/lib/ai/config';
import { replyButtonsForMessage } from '@/lib/ai/quick-replies';
import { handoffMessage, handoffReplyText } from '@/lib/ai/defaults';
import { appendRecommendationText } from '@/lib/ai/product-delivery';
import { buildPlaygroundProductCarousel } from '@/lib/ai/playground-carousel';
import { AiError, type ChatMessage } from '@/lib/ai/types';

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20;

/**
 * POST /api/ai/playground  (agent+)
 *
 * Test-chat with the account's agent WITHOUT touching WhatsApp. Runs the
 * exact same path the auto-reply bot uses — knowledge-base retrieval +
 * `auto_reply` system prompt + the configured provider — so what you see
 * here is what a real customer would get. Reads the config even when the
 * master switch is off (requireActive:false) so you can try it before
 * going live. Stateless: the client sends the running transcript each turn.
 */
export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('agent');

    const limit = checkRateLimit(
      `ai-playground:${userId}`,
      RATE_LIMITS.aiDraft
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = await request.json().catch(() => null);
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null;
    if (!rawMessages) {
      return NextResponse.json(
        { error: 'messages is required' },
        { status: 400 }
      );
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0
      )
      .slice(-MAX_TURNS);

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 }
      );
    }

    let config: Awaited<ReturnType<typeof loadAiConfig>>;
    try {
      config = await loadAiConfig(supabase, accountId, {
        requireActive: false,
      });
    } catch (err) {
      console.error('[ai/playground] loadAiConfig error:', err);
      const message =
        err instanceof Error &&
        /relation .* does not exist|Could not find the table/i.test(err.message)
          ? 'AI tables are missing — run pending Supabase migrations (090+), then retry.'
          : 'Stored API key could not be decrypted — ask super admin to replace it.';
      throw new AiError(message, {
        code: 'key_decrypt_failed',
        status: 400,
      });
    }
    if (!config) {
      return NextResponse.json(
        {
          error: 'Ask super admin to configure an AI model for this brand.',
          code: 'ai_not_configured',
        },
        { status: 400 }
      );
    }

    const contactId =
      body && typeof body.contact_id === 'string' ? body.contact_id.trim() : '';

    const outcome = await generateAgentReply({
      db: supabase,
      accountId,
      config,
      messages,
      // A signed-in teammate previewing a chosen contact's replies.
      verifiedContactId: contactId,
    });
    if (outcome.status === 'generation_failed') throw outcome.error;
    const {
      text,
      handoff,
      quickReplies,
      recommendedProducts,
      recommendationStore,
      hasProductCards,
    } = outcome.reply;

    const productCarousel =
      !handoff && hasProductCards
        ? buildPlaygroundProductCarousel(recommendedProducts, true)
        : null;

    const reply = handoff
      ? handoffReplyText(text, config.handoffMessage)
      : !hasProductCards
        ? appendRecommendationText(
            text,
            recommendedProducts,
            recommendationStore
          )
        : text;

    return NextResponse.json({
      reply,
      quick_replies:
        handoff || productCarousel
          ? []
          : replyButtonsForMessage(reply, quickReplies),
      handoff,
      // What the customer would be sent on handoff in a live chat.
      handoff_message: handoff ? handoffMessage(config.handoffMessage) : null,
      product_carousel: productCarousel,
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
