import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  getSubscribedApps,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/brands/[id]/whatsapp/verify-registration
 *
 * Super admin diagnostic — same checks as the brand-facing endpoint,
 * scoped to a specific brand by id.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const ctx = await requireSuperAdminBrand(id);

    const { data: config } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.brand.id)
      .maybeSingle();

    if (!config) {
      return NextResponse.json({
        live: false,
        checks: { config_exists: false },
        message: 'No WhatsApp configuration saved yet.',
      });
    }

    let accessToken: string;
    try {
      accessToken = decrypt(config.access_token);
    } catch {
      return NextResponse.json({
        live: false,
        checks: {
          config_exists: true,
          token_decryptable: false,
        },
        message:
          "Stored access token can't be decrypted — likely ENCRYPTION_KEY changed. Re-enter the token to repair.",
      });
    }

    const checks: {
      config_exists: boolean;
      token_decryptable: boolean;
      phone_metadata_ok: boolean;
      waba_subscribed_to_app: boolean | null;
      locally_marked_registered: boolean;
    } = {
      config_exists: true,
      token_decryptable: true,
      phone_metadata_ok: false,
      waba_subscribed_to_app: null,
      locally_marked_registered: config.registered_at != null,
    };
    const errors: string[] = [];

    try {
      await verifyPhoneNumber({
        phoneNumberId: config.phone_number_id,
        accessToken,
      });
      checks.phone_metadata_ok = true;
    } catch (err) {
      errors.push(
        `Phone metadata check failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (config.waba_id) {
      try {
        const subs = await getSubscribedApps({
          wabaId: config.waba_id,
          accessToken,
        });
        checks.waba_subscribed_to_app = subs.length > 0;
        if (!checks.waba_subscribed_to_app) {
          errors.push(
            'WABA has no subscribed apps. Re-save the configuration to subscribe.',
          );
        }
      } catch (err) {
        errors.push(
          `WABA subscription check failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    } else {
      errors.push(
        "No WABA ID on file — webhooks can't be wired without it. Add it in the form and re-save.",
      );
    }

    const live =
      checks.phone_metadata_ok &&
      (checks.waba_subscribed_to_app ?? false) &&
      checks.locally_marked_registered;

    return NextResponse.json({
      live,
      checks,
      errors,
      last_registration_error: config.last_registration_error ?? null,
      registered_at: config.registered_at ?? null,
      subscribed_apps_at: config.subscribed_apps_at ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
