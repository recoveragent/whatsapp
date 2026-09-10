// ============================================================
// /api/admin/templates/presets/[slug] — save, update, or delete.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  deleteAdminTemplatePresetOverride,
  listMergedAdminTemplatePresets,
  parsePresetPayload,
  saveAdminTemplatePresetOverride,
  updateAdminTemplateCustomPreset,
} from '@/lib/whatsapp/admin-template-preset-store';

/** PUT — save built-in override or update a custom template. */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const { supabase, organizationId, userId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      title?: unknown;
      description?: unknown;
      payload?: unknown;
      is_custom?: unknown;
    } | null;

    const payload = parsePresetPayload(body?.payload);
    if (!payload) {
      return NextResponse.json(
        { error: 'Valid template payload is required.' },
        { status: 400 },
      );
    }

    if (body?.is_custom === true) {
      const title = typeof body?.title === 'string' ? body.title.trim() : '';
      if (!title) {
        return NextResponse.json(
          { error: 'Gallery title is required.' },
          { status: 400 },
        );
      }
      await updateAdminTemplateCustomPreset(
        supabase,
        organizationId,
        userId,
        slug,
        {
          title,
          description:
            typeof body?.description === 'string' ? body.description : undefined,
          payload,
        },
      );
    } else {
      await saveAdminTemplatePresetOverride(
        supabase,
        organizationId,
        userId,
        slug,
        {
          title: typeof body?.title === 'string' ? body.title : undefined,
          description:
            typeof body?.description === 'string' ? body.description : undefined,
          payload,
        },
      );
    }

    const presets = await listMergedAdminTemplatePresets(
      supabase,
      organizationId,
    );
    const preset = presets.find((p) => p.slug === slug) ?? null;

    return NextResponse.json({ preset });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message === 'Unknown template preset.' ||
        err.message === 'Custom template not found.'
      ) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (
        err.message.includes('required') ||
        err.message.includes('must stay')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
    console.error('[PUT /api/admin/templates/presets/[slug]]', err);
    return toErrorResponse(err);
  }
}

/** DELETE — reset built-in override or remove a custom template. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const { supabase, organizationId } = await requireSuperAdmin();

    const result = await deleteAdminTemplatePresetOverride(
      supabase,
      organizationId,
      slug,
    );

    if (result === 'custom_deleted') {
      return NextResponse.json({ deleted: true, slug });
    }

    const presets = await listMergedAdminTemplatePresets(
      supabase,
      organizationId,
    );
    const preset = presets.find((p) => p.slug === slug) ?? null;

    return NextResponse.json({ preset, deleted: false });
  } catch (err) {
    if (err instanceof Error && err.message === 'Template not found.') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[DELETE /api/admin/templates/presets/[slug]]', err);
    return toErrorResponse(err);
  }
}
