import type { SupabaseClient } from '@supabase/supabase-js';

import { forbidden, notFound } from '@/lib/api/v1/respond';
import { toPublicTemplateSummary } from '@/lib/api/v1/template-params';
import { hasAnyScope } from '@/lib/api-keys/scopes';
import type { ApiKeyContext } from '@/lib/auth/api-context';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';

export function requireTemplatesScope(ctx: ApiKeyContext): void {
  if (!hasAnyScope(ctx.scopes, ['templates:read', 'messages:send'])) {
    throw forbidden(
      "This API key is missing the 'templates:read' or 'messages:send' scope",
    );
  }
}

export async function listApprovedTemplates(
  db: SupabaseClient,
  accountId: string,
) {
  const { data, error } = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('status', 'APPROVED')
    .order('name', { ascending: true });

  if (error) {
    console.error('[api/v1/templates] query failed:', error.message);
    throw error;
  }

  return (data ?? [])
    .filter(isMessageTemplate)
    .map(toPublicTemplateSummary);
}

async function findApprovedTemplateRow(
  db: SupabaseClient,
  accountId: string,
  templateId: string,
): Promise<MessageTemplate | null> {
  const byName = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateId)
    .eq('status', 'APPROVED')
    .maybeSingle();

  if (byName.data) {
    return isMessageTemplate(byName.data) ? byName.data : null;
  }

  const byUuid = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('id', templateId)
    .eq('status', 'APPROVED')
    .maybeSingle();

  if (!byUuid.data) return null;
  return isMessageTemplate(byUuid.data) ? byUuid.data : null;
}

export async function getApprovedTemplate(
  db: SupabaseClient,
  accountId: string,
  templateId: string,
) {
  const row = await findApprovedTemplateRow(db, accountId, templateId.trim());
  if (!row) {
    throw notFound(`Template "${templateId}" was not found or is not approved`);
  }
  return toPublicTemplateSummary(row);
}
