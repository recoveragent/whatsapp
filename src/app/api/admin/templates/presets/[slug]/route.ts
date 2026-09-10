// ============================================================
// /api/admin/templates/presets/[slug] — save or reset preset edits.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  deleteAdminTemplatePresetOverride,
  listMergedAdminTemplatePresets,
  saveAdminTemplatePresetOverride,
  type AdminTemplatePresetPayload,
} from '@/lib/whatsapp/admin-template-preset-store';

function parsePayload(raw: unknown): AdminTemplatePresetPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const headerFormat = body.header_format;
  if (
    headerFormat !== 'none' &&
    headerFormat !== 'text' &&
    headerFormat !== 'image' &&
    headerFormat !== 'video' &&
    headerFormat !== 'document'
  ) {
    return null;
  }
  const category = body.category;
  if (category !== 'Marketing' && category !== 'Utility') return null;
  if (typeof body.name !== 'string' || typeof body.body_text !== 'string') {
    return null;
  }
  return {
    name: body.name,
    category,
    language: typeof body.language === 'string' ? body.language : 'en_US',
    header_format: headerFormat,
    header_content:
      typeof body.header_content === 'string' ? body.header_content : '',
    header_media_url:
      typeof body.header_media_url === 'string' ? body.header_media_url : '',
    header_sample:
      typeof body.header_sample === 'string' ? body.header_sample : '',
    body_text: body.body_text,
    body_samples: Array.isArray(body.body_samples)
      ? body.body_samples.filter((v): v is string => typeof v === 'string')
      : [],
    footer_text: typeof body.footer_text === 'string' ? body.footer_text : '',
    buttons: Array.isArray(body.buttons) ? body.buttons : [],
  };
}

/** PUT — save org override for a built-in preset. */
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
    } | null;

    const payload = parsePayload(body?.payload);
    if (!payload) {
      return NextResponse.json(
        { error: 'Valid template payload is required.' },
        { status: 400 },
      );
    }

    await saveAdminTemplatePresetOverride(supabase, organizationId, userId, slug, {
      title: typeof body?.title === 'string' ? body.title : undefined,
      description:
        typeof body?.description === 'string' ? body.description : undefined,
      payload,
    });

    const presets = await listMergedAdminTemplatePresets(
      supabase,
      organizationId,
    );
    const preset = presets.find((p) => p.slug === slug) ?? null;

    return NextResponse.json({ preset });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unknown template preset.') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[PUT /api/admin/templates/presets/[slug]]', err);
    return toErrorResponse(err);
  }
}

/** DELETE — revert preset to built-in default. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const { supabase, organizationId } = await requireSuperAdmin();

    await deleteAdminTemplatePresetOverride(supabase, organizationId, slug);

    const presets = await listMergedAdminTemplatePresets(
      supabase,
      organizationId,
    );
    const preset = presets.find((p) => p.slug === slug) ?? null;

    return NextResponse.json({ preset });
  } catch (err) {
    if (err instanceof Error && err.message === 'Unknown template preset.') {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[DELETE /api/admin/templates/presets/[slug]]', err);
    return toErrorResponse(err);
  }
}
