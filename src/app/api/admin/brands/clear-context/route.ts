import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { toErrorResponse, UnauthorizedError } from '@/lib/auth/account';
import { isSuperAdminUser } from '@/lib/auth/super-admin';

/**
 * POST /api/admin/brands/clear-context
 *
 * Clears super-admin "acting brand" context so ops stays on the
 * brand-management surface instead of impersonating a workspace.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new UnauthorizedError();

    const isSuperAdmin = await isSuperAdminUser(supabase, user.id);
    if (!isSuperAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await supabase
      .from('organization_admin_context')
      .delete()
      .eq('user_id', user.id);

    if (error) {
      console.error('[POST /api/admin/brands/clear-context]', error);
      return NextResponse.json({ error: 'Could not clear brand context' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
