// ============================================================
// /api/admin/templates/presets — create custom gallery templates.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  createAdminTemplateCustomPreset,
  listMergedAdminTemplatePresets,
  parsePresetPayload,
} from '@/lib/whatsapp/admin-template-preset-store';

/** POST — save a new custom template to the org gallery. */
export async function POST(request: Request) {
  try {
    const { supabase, organizationId, userId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      title?: unknown;
      description?: unknown;
      payload?: unknown;
    } | null;

    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const payload = parsePresetPayload(body?.payload);

    if (!slug || !title || !payload) {
      return NextResponse.json(
        { error: 'Slug, gallery title, and template payload are required.' },
        { status: 400 },
      );
    }

    await createAdminTemplateCustomPreset(supabase, organizationId, userId, {
      slug,
      title,
      description:
        typeof body?.description === 'string' ? body.description : undefined,
      payload,
    });

    const presets = await listMergedAdminTemplatePresets(
      supabase,
      organizationId,
    );
    const preset = presets.find((p) => p.slug === slug) ?? null;

    return NextResponse.json({ preset }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes('already exists') ||
        err.message.includes('reserved') ||
        err.message.includes('required') ||
        err.message.includes('must match')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
    console.error('[POST /api/admin/templates/presets]', err);
    return toErrorResponse(err);
  }
}
