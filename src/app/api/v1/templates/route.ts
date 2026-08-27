// GET /api/v1/templates — approved templates for external integrators.

import { NextResponse } from 'next/server';

import { toPublicTemplateSummary } from '@/lib/api/v1/template-params';
import { forbidden, toApiErrorResponse } from '@/lib/api/v1/respond';
import { hasAnyScope } from '@/lib/api-keys/scopes';
import { requireApiKey } from '@/lib/auth/api-context';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request);
    if (!hasAnyScope(ctx.scopes, ['templates:read', 'messages:send'])) {
      throw forbidden(
        "This API key is missing the 'templates:read' or 'messages:send' scope",
      );
    }

    const { data, error } = await ctx.supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('status', 'APPROVED')
      .order('name', { ascending: true });

    if (error) {
      console.error('[api/v1/templates] query failed:', error.message);
      throw error;
    }

    const templates = (data ?? [])
      .filter(isMessageTemplate)
      .map(toPublicTemplateSummary);

    // Recover Agent contract uses a top-level `templates` array (not
    // the generic `{ data }` envelope used by GET /api/v1/me).
    return NextResponse.json({ templates });
  } catch (err) {
    return toApiErrorResponse(err);
  }
}
