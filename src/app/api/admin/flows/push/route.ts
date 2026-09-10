// ============================================================
// /api/admin/flows/push — duplicate a global preset to brands.
// ============================================================

import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import { getAdminFlowPresetSnapshot } from '@/lib/flows/admin-flow-preset-store';
import { insertFlowFromSnapshot } from '@/lib/flows/clone-flow-snapshot';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface BrandFlowPushResult {
  brandId: string;
  brandName: string;
  ok: boolean;
  error?: string;
  flowId?: string;
  flowName?: string;
}

/** POST — create a draft flow on each selected brand from a global preset. */
export async function POST(request: Request) {
  try {
    const { supabase, organizationId, userId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      presetSlug?: unknown;
      brandIds?: unknown;
      name?: unknown;
    } | null;

    const presetSlug =
      typeof body?.presetSlug === 'string' ? body.presetSlug.trim() : '';
    const brandIds = Array.isArray(body?.brandIds)
      ? [
          ...new Set(
            body.brandIds.filter(
              (id): id is string => typeof id === 'string' && id.length > 0,
            ),
          ),
        ]
      : [];

    if (!presetSlug) {
      return NextResponse.json(
        { error: 'Select a global flow preset.' },
        { status: 400 },
      );
    }
    if (brandIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one brand.' },
        { status: 400 },
      );
    }
    if (brandIds.length > 50) {
      return NextResponse.json(
        { error: 'You can deploy to at most 50 brands at once.' },
        { status: 400 },
      );
    }

    const snapshot = await getAdminFlowPresetSnapshot(
      supabase,
      organizationId,
      presetSlug,
    );
    if (!snapshot) {
      return NextResponse.json(
        { error: 'Global flow preset not found.' },
        { status: 404 },
      );
    }

    const admin = supabaseAdmin();
    const { data: brands, error: brandsErr } = await admin
      .from('accounts')
      .select('id, name, owner_user_id, organization_id')
      .in('id', brandIds)
      .eq('organization_id', organizationId);

    if (brandsErr) {
      console.error('[POST /api/admin/flows/push]', brandsErr);
      return NextResponse.json(
        { error: 'Failed to load brands' },
        { status: 500 },
      );
    }

    const brandById = new Map(
      (brands ?? []).map((b) => [b.id as string, b]),
    );
    const missing = brandIds.filter((id) => !brandById.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: 'One or more brands were not found in your organization.' },
        { status: 403 },
      );
    }

    const deployName =
      typeof body?.name === 'string' && body.name.trim()
        ? body.name.trim()
        : snapshot.name;

    const results: BrandFlowPushResult[] = [];

    for (const brandId of brandIds) {
      const brand = brandById.get(brandId)!;
      const authorUserId =
        (brand.owner_user_id as string | null) ?? userId;

      try {
        const created = await insertFlowFromSnapshot(admin, {
          accountId: brandId,
          userId: authorUserId,
          snapshot,
          name: deployName,
          resetTriggers: true,
        });
        results.push({
          brandId,
          brandName: brand.name as string,
          ok: true,
          flowId: created.id,
          flowName: created.name,
        });
      } catch (err) {
        results.push({
          brandId,
          brandName: brand.name as string,
          ok: false,
          error: err instanceof Error ? err.message : 'Deploy failed',
        });
      }
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.length - succeeded;

    return NextResponse.json({
      success: failed === 0,
      succeeded,
      failed,
      results,
    });
  } catch (err) {
    console.error('[POST /api/admin/flows/push]', err);
    return toErrorResponse(err);
  }
}
