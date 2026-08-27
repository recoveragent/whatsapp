// POST /api/v1/send — send an approved WhatsApp template by phone.

import { NextResponse } from 'next/server';

import { badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { sendExternalTemplateMessage } from '@/lib/api/v1/external-send';
import { requireApiKey } from '@/lib/auth/api-context';

interface SendRequestBody {
  template_id?: string;
  phone?: string;
  params?: string[] | Record<string, string>;
  metadata?: Record<string, string>;
}

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    let body: SendRequestBody;
    try {
      body = (await request.json()) as SendRequestBody;
    } catch {
      throw badRequest('Request body must be valid JSON');
    }

    const templateId = body.template_id?.trim();
    const phone = body.phone?.trim();
    if (!templateId) {
      throw badRequest('template_id is required');
    }
    if (!phone) {
      throw badRequest('phone is required');
    }

    if (
      body.params !== undefined &&
      !Array.isArray(body.params) &&
      (typeof body.params !== 'object' || body.params === null)
    ) {
      throw badRequest('params must be an array or object');
    }

    const result = await sendExternalTemplateMessage(ctx.supabase, {
      accountId: ctx.accountId,
      ownerUserId: ctx.createdBy,
      templateId,
      phone,
      params: body.params,
      metadata: body.metadata,
    });

    // Recover Agent contract uses a top-level success object (not `{ data }`).
    return NextResponse.json(result);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
