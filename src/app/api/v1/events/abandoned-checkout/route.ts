// POST /api/v1/events/abandoned-checkout — Recover Agent ABC mirror intake.

import { NextResponse } from 'next/server';

import {
  ingestRecoverAgentAbandonedCheckout,
  type RecoverAgentAbandonedCheckoutEvent,
} from '@/lib/api/v1/abandoned-checkout-event';
import { badRequest, forbidden, toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';
import { hasAnyScope } from '@/lib/api-keys/scopes';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    if (
      !hasAnyScope(ctx.scopes, ['messages:send', 'contacts:write'])
    ) {
      throw forbidden(
        'This API key needs the messages:send or contacts:write scope',
      );
    }

    let body: RecoverAgentAbandonedCheckoutEvent;
    try {
      body = (await request.json()) as RecoverAgentAbandonedCheckoutEvent;
    } catch {
      throw badRequest('Request body must be valid JSON');
    }

    await ingestRecoverAgentAbandonedCheckout({
      db: ctx.supabase,
      accountId: ctx.accountId,
      ownerUserId: ctx.createdBy,
      body,
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
