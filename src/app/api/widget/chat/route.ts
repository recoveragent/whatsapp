import { NextResponse } from 'next/server';
import { loadCurrentProduct, parseProductHandle } from '@/lib/website-widget/current-product';
import { supabaseAdmin } from '@/lib/ai/admin-client';
import { generateAgentReply } from '@/lib/ai/agent-reply';
import { loadAiConfig } from '@/lib/ai/config';
import { appendRecommendationText } from '@/lib/ai/product-delivery';
import { latestUserMessage } from '@/lib/ai/query';
import { replyButtonsForMessage } from '@/lib/ai/quick-replies';
import { logAiUsage } from '@/lib/ai/usage';
import { fetchAccountWithCategory } from '@/lib/auth/brand-accounts';
import { saveWebsiteTurn } from '@/lib/website-widget/inbox';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limit';
import {
  buildWhatsAppUrl,
  isOriginAllowed,
  loadEnabledWidget,
  parseWidgetMessages,
  toWidgetProducts,
  widgetClientIp,
  widgetCorsHeaders,
  widgetHandoffText,
} from '@/lib/website-widget/config';

const MAX_BODY_BYTES = 64 * 1024;

/** Preflight carries no key, so real checks happen on the request itself. */
export function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  return new Response(null, {
    status: 204,
    headers: origin ? widgetCorsHeaders(origin) : {},
  });
}

/**
 * POST /api/widget/chat?key=wgt_...  (public, anonymous)
 * Body: { messages: [{ role, content, productVariantIds? }] }
 *
 * The agent's next reply for a website visitor. Visitors are unverified, so
 * this must never pass a contact to the agent: no order data can be reached
 * from here. A separate anonymous website session is saved for the inbox.
 */
export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const noCors = (status: number) =>
    NextResponse.json({ error: 'Not found' }, { status });

  const ip = widgetClientIp(request);
  if (!checkRateLimit(`widget-config:${ip}`, RATE_LIMITS.widgetConfig).success)
    return noCors(404);

  const db = supabaseAdmin();
  const key = new URL(request.url).searchParams.get('key');
  const widget = await loadEnabledWidget(db, key);
  if (!widget || !origin || !isOriginAllowed(origin, widget.allowed_domains))
    return noCors(404);

  const headers = widgetCorsHeaders(origin);
  const fail = (status: number, code: string, extra?: object) =>
    NextResponse.json(
      {
        code,
        whatsapp_url: buildWhatsAppUrl(widget.whatsapp_number),
        ...extra,
      },
      { status, headers }
    );

  const visitorLimit = checkRateLimit(
    `widget-chat:${widget.account_id}:${ip}`,
    RATE_LIMITS.widgetVisitor
  );
  if (!visitorLimit.success) return fail(429, 'slow_down');

  const raw = await request.text().catch(() => '');
  if (raw.length > MAX_BODY_BYTES) return fail(413, 'too_large');
  let body: { messages?: unknown; session_key?: unknown; product_handle?: unknown } | null = null;
  try {
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_request');
  }
  const messages = parseWidgetMessages(body?.messages);
  if (!messages) return fail(400, 'invalid_request');

  // A separate bucket from WhatsApp auto-reply, so a flood of web traffic
  // can't stop the brand's existing customers from getting answers.
  const accountLimit = checkRateLimit(
    `widget-account:${widget.account_id}`,
    RATE_LIMITS.widgetAccount
  );
  if (!accountLimit.success) return fail(429, 'busy');

  try {
    const account = await fetchAccountWithCategory(db, widget.account_id);
    if (!account?.ai_agents_enabled) return fail(503, 'unavailable');

    const config = await loadAiConfig(db, widget.account_id);
    if (!config) return fail(503, 'unavailable');

    const { data: claimed, error: claimError } = await db.rpc(
      'claim_website_widget_reply',
      { target_account: widget.account_id }
    );
    if (claimError) throw claimError;
    if (claimed !== true) return fail(429, 'busy');

    await saveWebsiteTurn(db, widget.account_id, body?.session_key, 'user', latestUserMessage(messages)).catch((error) => console.error('[website widget] inbox save failed:', error));

    const handedOff = async (agentText: string) => {
      const whatsappUrl = buildWhatsAppUrl(
        widget.whatsapp_number,
        latestUserMessage(messages)
      );
      const reply = widgetHandoffText(agentText, whatsappUrl, account.brand_category);
      await saveWebsiteTurn(db, widget.account_id, body?.session_key, 'assistant', reply).catch((error) => console.error('[website widget] inbox save failed:', error));
      return NextResponse.json(
        {
          reply,
          quick_replies: [],
          handoff: true,
          whatsapp_url: whatsappUrl,
          products: [],
        },
        { headers }
      );
    };

    const productHandle = parseProductHandle(body?.product_handle);
    const currentProduct = productHandle
      ? await loadCurrentProduct(db, widget.account_id, productHandle)
      : undefined;

    const outcome = await generateAgentReply({
      db,
      accountId: widget.account_id,
      config,
      messages,
      channel: 'website',
      currentProduct: productHandle ? currentProduct : undefined,
      brandCategory: account.brand_category,
      // verifiedContactId is deliberately absent: see the note above.
    });
    if (outcome.status === 'generation_failed') {
      console.error('[website widget] generation failed:', outcome.error);
      return await handedOff('');
    }

    const {
      text,
      handoff,
      quickReplies,
      usage,
      recommendedProducts,
      recommendationStore,
      hasProductCards,
    } = outcome.reply;

    void logAiUsage(db, {
      accountId: widget.account_id,
      conversationId: null,
      mode: 'auto_reply',
      provider: config.provider,
      model: config.model,
      usage,
    });

    if (handoff || !text) return await handedOff(text);

    const products =
      hasProductCards && recommendationStore
        ? toWidgetProducts(recommendedProducts, recommendationStore.shopDomain)
        : [];
    const reply = hasProductCards
      ? text
      : appendRecommendationText(text, recommendedProducts, recommendationStore);

    const inboxReply = products.length
      ? `${reply}\n\n${products.map((product) => `${product.title} — ${product.price}\n${product.url}`).join('\n')}`
      : reply;
    await saveWebsiteTurn(db, widget.account_id, body?.session_key, 'assistant', inboxReply).catch((error) => console.error('[website widget] inbox save failed:', error));

    return NextResponse.json(
      {
        reply,
        quick_replies: products.length
          ? []
          : replyButtonsForMessage(reply, quickReplies),
        handoff: false,
        whatsapp_url: null,
        products,
      },
      { headers }
    );
  } catch (err) {
    console.error('[website widget] chat failed:', err);
    return fail(500, 'unavailable');
  }
}
