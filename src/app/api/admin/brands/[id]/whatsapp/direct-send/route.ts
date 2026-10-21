import { NextResponse } from 'next/server';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { normalizeDirectSendStatus } from '@/lib/whatsapp/direct-send';

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .select('id, direct_send_status')
      .eq('account_id', ctx.brand.id)
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Could not load Direct Send availability' },
        { status: 500 }
      );
    return NextResponse.json({
      config_id: data?.id ?? null,
      status: normalizeDirectSendStatus(data?.direct_send_status),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const body = await request.json();
    if (
      !['unknown', 'enabled', 'unavailable'].includes(body.status) ||
      typeof body.config_id !== 'string' ||
      (body.status === 'enabled' && body.meta_access_confirmed !== true)
    ) {
      return NextResponse.json(
        {
          error:
            'Select a valid status and confirm Meta access before enabling Direct Send',
        },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin()
      .from('whatsapp_config')
      .update({ direct_send_status: body.status })
      .eq('account_id', ctx.brand.id)
      .eq('id', body.config_id)
      .eq('status', 'connected')
      .select('id, direct_send_status')
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Could not save Direct Send availability' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Connected WhatsApp account not found' },
        { status: 404 }
      );
    return NextResponse.json({ status: data.direct_send_status });
  } catch (err) {
    return toErrorResponse(err);
  }
}
