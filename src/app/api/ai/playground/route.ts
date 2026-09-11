import { NextResponse } from 'next/server'
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { loadAiConfig } from '@/lib/ai/config'
import { retrieveKnowledge } from '@/lib/ai/knowledge'
import { generateReply } from '@/lib/ai/generate'
import { buildSystemPrompt } from '@/lib/ai/defaults'
import { latestUserMessage } from '@/lib/ai/query'
import { retrieveShopifyContext } from '@/lib/ai/shopify-context'
import { buildPlaygroundProductCarousel } from '@/lib/ai/playground-carousel'
import {
  buildProductSearchQuery,
  formatProductRecommendationsForAi,
  resolveRecommendedProducts,
  shouldOfferProductCarousel,
} from '@/lib/ai/product-recommendations'
import { AiError, type ChatMessage } from '@/lib/ai/types'

// Keep the tested transcript bounded, mirroring the live context window.
const MAX_TURNS = 20

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
    const { supabase, accountId, userId } = await requireAiAgentsAccount('agent')

    const limit = checkRateLimit(`ai-playground:${userId}`, RATE_LIMITS.aiDraft)
    if (!limit.success) return rateLimitResponse(limit)

    const body = await request.json().catch(() => null)
    const rawMessages = Array.isArray(body?.messages) ? body.messages : null
    if (!rawMessages) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 })
    }

    const messages: ChatMessage[] = rawMessages
      .filter(
        (m: unknown): m is ChatMessage =>
          !!m &&
          typeof m === 'object' &&
          ((m as ChatMessage).role === 'user' ||
            (m as ChatMessage).role === 'assistant') &&
          typeof (m as ChatMessage).content === 'string' &&
          (m as ChatMessage).content.trim().length > 0,
      )
      .slice(-MAX_TURNS)

    if (messages.length === 0) {
      return NextResponse.json(
        { error: 'Send a message to test the agent.' },
        { status: 400 },
      )
    }

    let config: Awaited<ReturnType<typeof loadAiConfig>>
    try {
      config = await loadAiConfig(supabase, accountId, { requireActive: false })
    } catch (err) {
      console.error('[ai/playground] loadAiConfig error:', err)
      const message =
        err instanceof Error &&
        /relation .* does not exist|Could not find the table/i.test(err.message)
          ? 'AI tables are missing — run pending Supabase migrations (090+), then retry.'
          : 'Stored API key could not be decrypted — re-enter your key in Setup.'
      throw new AiError(message, {
        code: 'key_decrypt_failed',
        status: 400,
      })
    }
    if (!config) {
      return NextResponse.json(
        {
          error: 'No agent configured yet. Add your provider key in Setup.',
          code: 'ai_not_configured',
        },
        { status: 400 },
      )
    }

    const contactId =
      body && typeof body.contact_id === 'string' ? body.contact_id.trim() : ''

    const latestQuestion = latestUserMessage(messages)
    const wantsProductCarousel = shouldOfferProductCarousel(messages)
    const productSearchQuery = buildProductSearchQuery(messages)

    const [knowledge, shopifyContext, shopifyConfig] = await Promise.all([
      retrieveKnowledge(supabase, accountId, config, latestQuestion),
      contactId
        ? retrieveShopifyContext(supabase, accountId, contactId)
        : Promise.resolve(null),
      wantsProductCarousel
        ? supabase
            .from('shopify_config')
            .select('status, sell_on_whatsapp_enabled')
            .eq('account_id', accountId)
            .maybeSingle()
            .then(({ data }) => data)
        : Promise.resolve(null),
    ])

    const recommendedProducts = wantsProductCarousel
      ? await resolveRecommendedProducts(
          supabase,
          accountId,
          productSearchQuery,
          knowledge,
        ).catch(() => [])
      : []

    const hasCarouselProducts = recommendedProducts.length >= 2
    const productRecommendations = hasCarouselProducts
      ? formatProductRecommendationsForAi(recommendedProducts)
      : null

    const systemPrompt = buildSystemPrompt({
      userPrompt: config.systemPrompt,
      mode: 'auto_reply',
      knowledge,
      shopifyContext,
      productRecommendations,
      productBrowseNoMatches: wantsProductCarousel && !hasCarouselProducts,
    })

    const { text, handoff } = await generateReply({ config, systemPrompt, messages })

    const carouselLiveReady =
      shopifyConfig?.status === 'connected' &&
      Boolean(shopifyConfig.sell_on_whatsapp_enabled)

    const productCarousel =
      !handoff && recommendedProducts.length >= 2
        ? buildPlaygroundProductCarousel(recommendedProducts, carouselLiveReady)
        : null

    return NextResponse.json({ reply: text, handoff, product_carousel: productCarousel })
  } catch (err) {
    if (err instanceof AiError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.status },
      )
    }
    return toErrorResponse(err)
  }
}
