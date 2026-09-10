import { NextResponse } from 'next/server';

import { ingestProductLinkSentEvent } from '@/lib/api/v1/product-link-sent-event';
import { badRequest, forbidden, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { hasAnyScope } from '@/lib/api-keys/scopes';

/**
 * POST /api/v1/events/product-link-sent
 * Send a Shopify product card from an external integration.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    if (!hasAnyScope(ctx.scopes, ['messages:send'])) {
      throw forbidden("This API key needs the messages:send scope");
    }

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw badRequest('Request body must be valid JSON');
    }

    const result = await ingestProductLinkSentEvent({
      db: ctx.supabase,
      accountId: ctx.accountId,
      ownerUserId: ctx.createdBy,
      body: body as Parameters<typeof ingestProductLinkSentEvent>[0]['body'],
    });

    return NextResponse.json({ data: result }, { status: 202 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
