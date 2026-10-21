import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { normalizeDirectSendStatus } from '@/lib/whatsapp/direct-send';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const configId = new URL(request.url).searchParams.get('config_id');
    let query = ctx.supabase
      .from('whatsapp_config')
      .select('id, direct_send_status')
      .eq('account_id', ctx.accountId);
    if (configId) query = query.eq('id', configId);
    const { data, error } = await query.maybeSingle();
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

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
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
    const { data, error } = await ctx.supabase
      .from('whatsapp_config')
      .update({ direct_send_status: body.status })
      .eq('account_id', ctx.accountId)
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
