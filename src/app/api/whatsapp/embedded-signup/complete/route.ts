import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  generateWebhookVerifyToken,
  isEmbeddedSignupEnabled,
} from '@/lib/whatsapp/embedded-signup';
import { exchangeEmbeddedSignupCode } from '@/lib/whatsapp/exchange-oauth-code';
import { persistWhatsAppConfig } from '@/lib/whatsapp/persist-config';

interface CompleteBody {
  code?: unknown;
  waba_id?: unknown;
  phone_number_id?: unknown;
  pin?: unknown;
}

/**
 * POST /api/whatsapp/embedded-signup/complete
 *
 * Brand admin completes Meta Embedded Signup — exchanges the OAuth code,
 * stores encrypted credentials, and subscribes the WABA to this app.
 */
export async function POST(request: Request) {
  try {
    if (!isEmbeddedSignupEnabled()) {
      return NextResponse.json(
        { error: 'WhatsApp Embedded Signup is not configured on this deployment' },
        { status: 503 },
      );
    }

    const ctx = await requireRole('admin');

    const body = (await request.json().catch(() => null)) as CompleteBody | null;

    const code = typeof body?.code === 'string' ? body.code.trim() : '';
    const wabaId = typeof body?.waba_id === 'string' ? body.waba_id.trim() : '';
    const phoneNumberId =
      typeof body?.phone_number_id === 'string' ? body.phone_number_id.trim() : '';
    const pin =
      body?.pin === undefined || body?.pin === null || body?.pin === ''
        ? null
        : typeof body?.pin === 'string'
          ? body.pin.trim()
          : null;

    if (!code) {
      return NextResponse.json({ error: 'code is required' }, { status: 400 });
    }
    if (!wabaId) {
      return NextResponse.json({ error: 'waba_id is required' }, { status: 400 });
    }
    if (!phoneNumberId) {
      return NextResponse.json(
        { error: 'phone_number_id is required' },
        { status: 400 },
      );
    }

    if (pin !== null && !/^\d{6}$/.test(pin)) {
      return NextResponse.json(
        { error: 'PIN must be exactly 6 digits when provided' },
        { status: 400 },
      );
    }

    let accessToken: string;
    try {
      accessToken = await exchangeEmbeddedSignupCode(code);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Token exchange failed';
      console.error('[embedded-signup/complete] exchange failed:', message);
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const verifyToken = generateWebhookVerifyToken();

    const result = await persistWhatsAppConfig({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId: ctx.accountId,
      phone_number_id: phoneNumberId,
      waba_id: wabaId,
      access_token: accessToken,
      verify_token: verifyToken,
      pin,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    if (result.registration_error) {
      return NextResponse.json({
        success: false,
        saved: true,
        registered: false,
        registration_error: result.registration_error,
        phone_info: result.phone_info,
        message:
          'Connected to Meta, but inbound registration needs a 2-step PIN. Add your PIN below and try again.',
      });
    }

    return NextResponse.json({
      success: true,
      saved: true,
      registered: result.registered,
      registration_skipped: result.registration_skipped,
      phone_info: result.phone_info,
    });
  } catch (err) {
    console.error('[POST /api/whatsapp/embedded-signup/complete]', err);
    return toErrorResponse(err);
  }
}
