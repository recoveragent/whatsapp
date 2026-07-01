import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import { persistWhatsAppConfig } from '@/lib/whatsapp/persist-config';
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api';

type RouteContext = { params: Promise<{ id: string }> };

async function healthCheck(
  config: {
    phone_number_id: string;
    access_token: string;
  } | null,
) {
  if (!config) {
    return {
      connected: false,
      reason: 'no_config',
      message:
        'No WhatsApp configuration saved yet. Fill in the form and click Save Configuration.',
    };
  }

  let accessToken: string;
  try {
    accessToken = decrypt(config.access_token);
  } catch (err) {
    console.error('[admin whatsapp GET] Token decryption failed:', err);
    return {
      connected: false,
      reason: 'token_corrupted',
      needs_reset: true,
      message:
        'The stored access token cannot be decrypted with the current ENCRYPTION_KEY. Click "Reset Configuration", then re-save.',
    };
  }

  try {
    const phoneInfo = await verifyPhoneNumber({
      phoneNumberId: config.phone_number_id,
      accessToken,
    });
    return { connected: true, phone_info: phoneInfo };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('[admin whatsapp GET] Meta API verification failed:', message);
    return {
      connected: false,
      reason: 'meta_api_error',
      message: `Meta API rejected the credentials: ${message}`,
    };
  }
}

/**
 * GET /api/admin/brands/[id]/whatsapp
 *
 * Super admin only — loads safe config fields + health check for ops form.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const accountId = ctx.brand.id;

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select(
        'phone_number_id, waba_id, status, registered_at, connected_at, last_registration_error, subscribed_apps_at, access_token',
      )
      .eq('account_id', accountId)
      .maybeSingle();

    if (configError) {
      console.error('[GET /api/admin/brands/whatsapp]', configError);
      return NextResponse.json(
        { error: 'Failed to load configuration' },
        { status: 500 },
      );
    }

    const safeConfig = config
      ? {
          phone_number_id: config.phone_number_id,
          waba_id: config.waba_id,
          status: config.status,
          registered_at: config.registered_at,
          connected_at: config.connected_at,
          last_registration_error: config.last_registration_error,
          subscribed_apps_at: config.subscribed_apps_at,
          has_access_token: Boolean(config.access_token),
        }
      : null;

    const health = await healthCheck(config);

    return NextResponse.json({
      brand: ctx.brand,
      config: safeConfig,
      health,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * POST /api/admin/brands/[id]/whatsapp
 *
 * Super admin only — verify with Meta, encrypt, and persist credentials.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);
    const accountId = ctx.brand.id;

    const body = await request.json();
    const { phone_number_id, waba_id, access_token, verify_token, pin } = body;

    if (!phone_number_id) {
      return NextResponse.json(
        { error: 'phone_number_id is required' },
        { status: 400 },
      );
    }

    const { data: existing } = await ctx.supabase
      .from('whatsapp_config')
      .select('access_token')
      .eq('account_id', accountId)
      .maybeSingle();

    let resolvedToken =
      typeof access_token === 'string' && access_token.trim()
        ? access_token.trim()
        : null;

    if (!resolvedToken && existing?.access_token) {
      try {
        resolvedToken = decrypt(existing.access_token);
      } catch {
        return NextResponse.json(
          {
            error:
              'Stored access token cannot be decrypted. Reset configuration and re-enter the token.',
          },
          { status: 400 },
        );
      }
    }

    if (!resolvedToken) {
      return NextResponse.json(
        { error: 'access_token is required' },
        { status: 400 },
      );
    }

    const result = await persistWhatsAppConfig({
      supabase: ctx.supabase,
      userId: ctx.userId,
      accountId,
      phone_number_id,
      waba_id: waba_id || null,
      access_token: resolvedToken,
      verify_token: verify_token || null,
      pin: pin ?? null,
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
    console.error('[POST /api/admin/brands/whatsapp]', err);
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/admin/brands/[id]/whatsapp
 *
 * Super admin only — clears stored credentials for a brand.
 */
export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);

    const { error: deleteError } = await ctx.supabase
      .from('whatsapp_config')
      .delete()
      .eq('account_id', ctx.brand.id);

    if (deleteError) {
      console.error('[DELETE /api/admin/brands/whatsapp]', deleteError);
      return NextResponse.json(
        { error: 'Failed to delete configuration' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
