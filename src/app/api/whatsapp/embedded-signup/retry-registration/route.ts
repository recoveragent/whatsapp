import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import { registerPhoneNumber } from '@/lib/whatsapp/meta-api';

/**
 * POST /api/whatsapp/embedded-signup/retry-registration
 *
 * After Embedded Signup saved credentials but /register failed (missing PIN),
 * brand admins can retry with their two-step verification PIN.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as { pin?: unknown } | null;
    const pin = typeof body?.pin === 'string' ? body.pin.trim() : '';

    if (!/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be exactly 6 digits' },
        { status: 400 },
      );
    }

    const { data: config, error: fetchError } = await ctx.supabase
      .from('whatsapp_config')
      .select('phone_number_id, access_token')
      .eq('account_id', ctx.accountId)
      .maybeSingle();

    if (fetchError || !config?.access_token || !config.phone_number_id) {
      return NextResponse.json(
        { error: 'No WhatsApp configuration found for this workspace' },
        { status: 404 },
      );
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json(
        { error: 'Stored access token cannot be decrypted. Reconnect with Meta.' },
        { status: 400 },
      );
    }

    try {
      await registerPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
        pin,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      await ctx.supabase
        .from('whatsapp_config')
        .update({
          last_registration_error: message,
          status: 'disconnected',
          updated_at: new Date().toISOString(),
        })
        .eq('account_id', ctx.accountId);

      return NextResponse.json({ error: message }, { status: 400 });
    }

    const now = new Date().toISOString();
    await ctx.supabase
      .from('whatsapp_config')
      .update({
        registered_at: now,
        connected_at: now,
        status: 'connected',
        last_registration_error: null,
        updated_at: now,
      })
      .eq('account_id', ctx.accountId);

    return NextResponse.json({ success: true, registered: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
