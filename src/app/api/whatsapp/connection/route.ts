import { NextResponse } from 'next/server';

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  classifyMetaAccessError,
  MetaApiError,
  verifyPhoneNumber,
  type MetaAccessErrorKind,
} from '@/lib/whatsapp/meta-api';
import { supabaseAdmin } from '@/lib/supabase/admin';

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
        'id, phone_number_id, status, registered_at, connected_at, last_registration_error, access_token, meta_disconnected_at, meta_disconnect_reason'
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

    let phoneInfo: Awaited<ReturnType<typeof verifyPhoneNumber>> | null = null;
    let access: 'ok' | 'not_registered' | MetaAccessErrorKind = 'ok';
    let metaError: {
      code: number | null;
      subcode: number | null;
      message: string;
      fbtrace_id: string | null;
    } | null = null;
    try {
      phoneInfo = await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken: decrypt(config.access_token),
      });
      // Readable but not on Cloud API (e.g. ON_PREMISE after an unfinished
      // coexistence onboarding): every send fails with 133010.
      if (phoneInfo.platform_type && phoneInfo.platform_type !== 'CLOUD_API') {
        access = 'not_registered';
      }
    } catch (err) {
      console.warn('[GET /api/whatsapp/connection] Meta verify failed:', err);
      access = classifyMetaAccessError(err);
      metaError = {
        code: err instanceof MetaApiError ? err.code ?? null : null,
        subcode: err instanceof MetaApiError ? err.subcode ?? null : null,
        message: err instanceof Error ? err.message : 'Meta API request failed.',
        fbtrace_id: err instanceof MetaApiError ? err.fbtraceId ?? null : null,
      };
    }

    // The account_update webhook marked this number disconnected, but
    // Meta grants access again (reconnected outside Embedded Signup).
    if (access === 'ok' && config.meta_disconnected_at) {
      await supabaseAdmin()
        .from('whatsapp_config')
        .update({ status: 'connected', meta_disconnected_at: null, meta_disconnect_reason: null })
        .eq('id', config.id);
    }

    const connected = access === 'ok';
    const needsReconnect =
      access === 'access_revoked' ||
      access === 'not_registered' ||
      (access === 'check_failed' && Boolean(config.meta_disconnected_at));
    const codeLabel = metaError?.code != null
      ? ` (Meta code ${[metaError.code, metaError.subcode].filter((n) => n != null).join('/')})`
      : '';

    return NextResponse.json({
      configured: true,
      connected,
      needs_reconnect: needsReconnect,
      access,
      meta_error: metaError,
      meta_disconnected_at: connected ? null : config.meta_disconnected_at,
      meta_disconnect_reason: connected ? null : config.meta_disconnect_reason,
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
        : access === 'not_registered'
          ? `Meta shows this number as not registered for the WhatsApp Cloud API (platform: ${phoneInfo?.platform_type}), so messages fail with “Account not registered”. The WhatsApp Business app link was not completed.`
          : needsReconnect
          ? `${config.meta_disconnect_reason ?? 'Meta no longer gives Recover Agent access to this number.'}${codeLabel}`
          : `Meta did not confirm this number's status right now${codeLabel}. Messaging may still work — check again in a few minutes.`,
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
      .update({ direct_send_status: 'unknown', access_token: '', verify_token: null, status: 'disconnected', connected_at: null, registered_at: null, last_registration_error: null, meta_disconnected_at: null, meta_disconnect_reason: null })
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
