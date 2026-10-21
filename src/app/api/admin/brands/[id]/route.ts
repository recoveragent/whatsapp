import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isBrandCategory } from '@/lib/auth/brand-category';
import { isEcommercePlatform } from '@/lib/ecommerce/platform';
import {
  AI_AGENTS_MIGRATION_HINT,
  BRAND_CATEGORY_MIGRATION_HINT,
  isMissingColumnError,
} from '@/lib/auth/brand-accounts';
import { toErrorResponse, UnauthorizedError, ForbiddenError } from '@/lib/auth/account';

type RouteContext = { params: Promise<{ id: string }> };

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member?.organization_id) {
    throw new ForbiddenError('Super admin access required');
  }

  return { supabase, organizationId: member.organization_id };
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { supabase, organizationId } = await requireSuperAdmin();
    const { id } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      category?: unknown;
      ecommerce_platform?: unknown;
      ai_agents_enabled?: unknown;
    } | null;

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body?.category !== undefined) {
      if (!isBrandCategory(body.category)) {
        return NextResponse.json({ error: 'Invalid brand category' }, { status: 400 });
      }
      updates.brand_category = body.category;
    }

    if (body?.ai_agents_enabled !== undefined) {
      if (typeof body.ai_agents_enabled !== 'boolean') {
        return NextResponse.json({ error: 'Invalid AI agents flag' }, { status: 400 });
      }
      updates.ai_agents_enabled = body.ai_agents_enabled;
    }

    if (body?.ecommerce_platform !== undefined) {
      if (!isEcommercePlatform(body.ecommerce_platform)) {
        return NextResponse.json({ error: 'Invalid store platform' }, { status: 400 });
      }
      if (body.category !== undefined && body.category !== 'ecommerce') {
        return NextResponse.json({ error: 'Store platform requires an ecommerce brand' }, { status: 400 });
      }
      updates.ecommerce_platform = body.ecommerce_platform;
    }

    if (Object.keys(updates).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    let query = supabase
      .from('accounts')
      .update(updates)
      .eq('id', id)
      .eq('organization_id', organizationId);
    // Enforce category in the write so a concurrent category change cannot
    // apply a store platform to a lead-generation workspace.
    if (body?.ecommerce_platform !== undefined && body.category !== 'ecommerce') {
      query = query.eq('brand_category', 'ecommerce');
    }
    const { data, error } = await query
      .select(`id, name, brand_category, ai_agents_enabled${body?.ecommerce_platform !== undefined ? ', ecommerce_platform' : ''}`)
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/admin/brands/[id]]', error);
      if (isMissingColumnError(error, 'ecommerce_platform')) {
        return NextResponse.json(
          { error: 'Store platforms require database migration 061_woocommerce_platform.sql.' },
          { status: 503 },
        );
      }
      if (isMissingColumnError(error, 'brand_category')) {
        return NextResponse.json(
          { error: `Brand category is not available yet. ${BRAND_CATEGORY_MIGRATION_HINT}` },
          { status: 503 },
        );
      }
      if (isMissingColumnError(error, 'ai_agents_enabled')) {
        return NextResponse.json(
          { error: `AI agents toggle is not available yet. ${AI_AGENTS_MIGRATION_HINT}` },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: 'Failed to update brand' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Brand not found or not eligible for this update' }, { status: 404 });
    }

    return NextResponse.json({ brand: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
