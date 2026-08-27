// GET /api/v1/templates — approved templates for external integrators.

import { NextResponse } from 'next/server';

import {
  listApprovedTemplates,
  requireTemplatesScope,
} from '@/lib/api/v1/templates-api';
import { toApiErrorResponse } from '@/lib/api/v1/respond';
import { requireApiKey } from '@/lib/auth/api-context';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    requireTemplatesScope(ctx);

    const templates = await listApprovedTemplates(ctx.supabase, ctx.accountId);

    // Recover Agent contract uses a top-level `templates` array (not
    // the generic `{ data }` envelope used by GET /api/v1/me).
    return NextResponse.json({ templates });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
