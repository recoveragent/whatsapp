// GET /api/v1/templates/:id — one approved template with full preview text.

import { NextResponse } from 'next/server';

import { toApiErrorResponse } from '@/lib/api/v1/respond';
import {
  getApprovedTemplate,
  requireTemplatesScope,
} from '@/lib/api/v1/templates-api';
import { requireApiKey } from '@/lib/auth/api-context';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const ctx = await requireApiKey(request);
    requireTemplatesScope(ctx);

    const { id } = await context.params;
    const template = await getApprovedTemplate(ctx.supabase, ctx.accountId, id);

    return NextResponse.json(template);
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
