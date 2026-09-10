// ============================================================
// /api/admin/flows/presets — save a brand flow as global preset.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  createAdminFlowPresetFromFlow,
  listAdminFlowPresets,
} from '@/lib/flows/admin-flow-preset-store';
import { slugifyFlowPresetName } from '@/lib/flows/clone-flow-snapshot';
import { supabaseAdmin } from '@/lib/supabase/admin';

/** POST — snapshot a flow from any org brand into the global gallery. */
export async function POST(request: Request) {
  try {
    const { supabase, organizationId, userId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      flowId?: unknown;
      brandId?: unknown;
      brandName?: unknown;
      title?: unknown;
      description?: unknown;
      slug?: unknown;
    } | null;

    const flowId = typeof body?.flowId === 'string' ? body.flowId.trim() : '';
    const brandId = typeof body?.brandId === 'string' ? body.brandId.trim() : '';
    const brandName =
      typeof body?.brandName === 'string' ? body.brandName.trim() : '';
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const slug =
      typeof body?.slug === 'string' && body.slug.trim()
        ? body.slug.trim()
        : slugifyFlowPresetName(title);

    if (!flowId || !brandId || !title) {
      return NextResponse.json(
        { error: 'flowId, brandId, and title are required.' },
        { status: 400 },
      );
    }

    if (!/^[a-z0-9_]{1,128}$/.test(slug)) {
      return NextResponse.json(
        {
          error:
            'Slug must use lowercase letters, digits, and underscores only.',
        },
        { status: 400 },
      );
    }

    const preset = await createAdminFlowPresetFromFlow(
      supabase,
      supabaseAdmin(),
      organizationId,
      userId,
      {
        flowId,
        brandId,
        brandName,
        title,
        description:
          typeof body?.description === 'string' ? body.description : undefined,
        slug,
      },
    );

    const presets = await listAdminFlowPresets(supabase, organizationId);

    return NextResponse.json({ preset, presets }, { status: 201 });
  } catch (err) {
    if (err instanceof Error) {
      if (
        err.message.includes('not found') ||
        err.message.includes('already exists') ||
        err.message.includes('required')
      ) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
    }
    console.error('[POST /api/admin/flows/presets]', err);
    return toErrorResponse(err);
  }
}
