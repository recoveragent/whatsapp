import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { isBrandCategory } from '@/lib/auth/brand-category';
import {
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
    const body = (await request.json().catch(() => null)) as { category?: unknown } | null;

    if (!isBrandCategory(body?.category)) {
      return NextResponse.json({ error: 'Invalid brand category' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('accounts')
      .update({ brand_category: body.category, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('organization_id', organizationId)
      .select('id, name, brand_category')
      .maybeSingle();

    if (error) {
      console.error('[PATCH /api/admin/brands/[id]]', error);
      if (isMissingColumnError(error, 'brand_category')) {
        return NextResponse.json(
          { error: `Brand category is not available yet. ${BRAND_CATEGORY_MIGRATION_HINT}` },
          { status: 503 },
        );
      }
      return NextResponse.json({ error: 'Failed to update brand' }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
    }

    return NextResponse.json({ brand: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}
