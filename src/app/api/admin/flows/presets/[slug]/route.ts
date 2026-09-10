// ============================================================
// /api/admin/flows/presets/[slug] — delete a global flow preset.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import {
  deleteAdminFlowPreset,
  listAdminFlowPresets,
} from '@/lib/flows/admin-flow-preset-store';

/** DELETE — remove a global flow preset from the gallery. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const { supabase, organizationId } = await requireSuperAdmin();

    await deleteAdminFlowPreset(supabase, organizationId, slug);

    const presets = await listAdminFlowPresets(supabase, organizationId);
    return NextResponse.json({ deleted: true, slug, presets });
  } catch (err) {
    console.error('[DELETE /api/admin/flows/presets/[slug]]', err);
    return toErrorResponse(err);
  }
}
