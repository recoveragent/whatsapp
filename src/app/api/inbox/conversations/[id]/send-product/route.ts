import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { canSendMessages } from '@/lib/auth/roles';
import { assertEcommercePlatform } from '@/lib/ecommerce/assert-platform';
import { sendShopifyProductCard } from '@/lib/shopify/send-product-card';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

/**
 * POST /api/inbox/conversations/[id]/send-product
 * Body: { shopify_variant_id, quantity?, reply_to_message_id? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await getCurrentAccount();
    if (!canSendMessages(ctx.role)) {
      throw new ForbiddenError('Your role cannot send messages');
    }

    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const platform = await assertEcommercePlatform(ctx.supabase, ctx.accountId, 'shopify');
    if (!platform.ok) {
      return NextResponse.json({ error: platform.error }, { status: platform.status });
    }

    const { id: conversationId } = await params;
    const body = await request.json();
    const shopifyVariantId = body.shopify_variant_id;
    const quantity =
      typeof body.quantity === 'number' && Number.isFinite(body.quantity)
        ? body.quantity
        : undefined;
    const replyToMessageId =
      typeof body.reply_to_message_id === 'string'
        ? body.reply_to_message_id
        : undefined;

    if (shopifyVariantId == null || String(shopifyVariantId).trim() === '') {
      return NextResponse.json(
        { error: 'shopify_variant_id is required' },
        { status: 400 },
      );
    }

    const result = await sendShopifyProductCard({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      conversationId,
      shopifyVariantId,
      quantity,
      replyToMessageId,
    });

    return NextResponse.json({
      success: true,
      message_id: result.message_id,
      whatsapp_message_id: result.whatsapp_message_id,
      checkout_url: result.checkout_url,
      product_title: result.product_title,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to send product';
    if (
      message.includes('Self-assign') ||
      message.includes('assigned to someone else')
    ) {
      return NextResponse.json({ error: message }, { status: 403 });
    }
    if (
      message.includes('not found') ||
      message.includes('not enabled') ||
      message.includes('out of stock')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return toErrorResponse(err);
  }
}
