// ============================================================
// /api/admin/templates/defaults — mark gallery templates as default.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  listDefaultTemplateSlugs,
  setDefaultTemplate,
} from '@/lib/whatsapp/admin-template-defaults';

/**
 * PUT { slug, isDefault }
 *
 * Default templates show up in every brand's Template library,
 * waiting for the brand to review and submit them to Meta.
 */
export async function PUT(request: Request) {
  try {
    const { supabase, organizationId, userId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      slug?: unknown;
      isDefault?: unknown;
    } | null;

    const slug = typeof body?.slug === 'string' ? body.slug.trim() : '';
    if (!/^[a-z0-9_]{1,128}$/.test(slug) || typeof body?.isDefault !== 'boolean') {
      return NextResponse.json(
        { error: 'A valid slug and isDefault flag are required.' },
        { status: 400 },
      );
    }

    await setDefaultTemplate(
      supabase,
      organizationId,
      userId,
      slug,
      body.isDefault,
    );
    const defaultSlugs = await listDefaultTemplateSlugs(supabase, organizationId);

    return NextResponse.json({ defaultSlugs });
  } catch (err) {
    console.error('[PUT /api/admin/templates/defaults]', err);
    return toErrorResponse(err);
  }
}
