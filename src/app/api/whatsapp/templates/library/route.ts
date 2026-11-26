// ============================================================
// /api/whatsapp/templates/library — org default templates that the
// current brand has not submitted yet (waiting for review).
// ============================================================

import { NextResponse } from 'next/server';

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { listPendingLibraryTemplates } from '@/lib/whatsapp/admin-template-defaults';
import { supabaseAdmin } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const { accountId } = await getCurrentAccount();
    const admin = supabaseAdmin();

    const { data: account, error: accountErr } = await admin
      .from('accounts')
      .select('organization_id')
      .eq('id', accountId)
      .maybeSingle();
    if (accountErr) throw accountErr;

    const organizationId = account?.organization_id as string | undefined;
    if (!organizationId) return NextResponse.json({ templates: [] });

    const templates = await listPendingLibraryTemplates(
      admin,
      organizationId,
      accountId,
    );

    return NextResponse.json({
      templates: templates.map(({ slug, title, description, preset }) => ({
        slug,
        title,
        description,
        media_note: preset.media_note ?? null,
        payload: {
          name: preset.name,
          category: preset.category,
          language: preset.language,
          header_format: preset.header_format,
          header_content: preset.header_content,
          header_media_url: preset.header_media_url,
          header_sample: preset.header_sample,
          body_text: preset.body_text,
          body_samples: preset.body_samples,
          footer_text: preset.footer_text,
          buttons: preset.buttons,
        },
      })),
    });
  } catch (err) {
    console.error('[GET /api/whatsapp/templates/library]', err);
    return toErrorResponse(err);
  }
}
