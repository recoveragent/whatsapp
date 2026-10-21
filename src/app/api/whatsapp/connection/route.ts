import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * GET /api/whatsapp/connection
 *
 * Brand-facing status — no API credentials exposed. Ops configures
 * tokens via /admin/brands/[id]/whatsapp.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: config, error } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'id, phone_number_id, status, registered_at, connected_at, last_registration_error, access_token'
      )
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error('[GET /api/whatsapp/connection]', error);
      return NextResponse.json(
        { error: 'Failed to load connection status' },
        { status: 500 }
      );
    }

    if (!config?.access_token) {
      return NextResponse.json({
        configured: false,
        connected: false,
        needs_reconnect: false,
        message:
          'No WhatsApp number is connected yet. Use Connect with Meta to link your WhatsApp Business number.',
      });
    }

    let phoneInfo: { verified_name?: string; display_phone_number?: string } | null = null;
    let connected = false;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
      });
      connected = true;
    } catch (err) {
      console.warn('[GET /api/whatsapp/connection] Meta verify failed:', err);
    }

    return NextResponse.json({
      configured: true,
      connected,
      needs_reconnect: !connected,
      id: config.id,
      phone_number_id: config.phone_number_id,
      verified_name: phoneInfo?.verified_name ?? null,
      display_phone_number: phoneInfo?.display_phone_number ?? null,
      status: config.status,
      registered: Boolean(config.registered_at),
      registered_at: config.registered_at,
      last_registration_error: config.last_registration_error,
      message: connected
        ? undefined
        : 'This number is no longer valid with Meta (removed, revoked, or incomplete). Disconnect it, then connect a new number.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/whatsapp/connection
 *
 * Brand admin — clears stored WhatsApp credentials so a new number can be linked.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const configId = new URL(request.url).searchParams.get('id');
    if (!configId) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const { error } = await ctx.supabase
      .from('whatsapp_config')
      .update({ direct_send_status: 'unknown', access_token: '', verify_token: null, status: 'disconnected', connected_at: null, registered_at: null, last_registration_error: null })
      .eq('account_id', ctx.accountId)
      .eq('id', configId);

    if (error) {
      console.error('[DELETE /api/whatsapp/connection]', error);
      return NextResponse.json(
        { error: 'Failed to disconnect WhatsApp' },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
