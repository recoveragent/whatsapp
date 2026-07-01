import type { SupabaseClient } from '@supabase/supabase-js';

import { supabaseAdmin } from '@/lib/supabase/admin';
import { encrypt } from '@/lib/whatsapp/encryption';
import {
  registerPhoneNumber,
  subscribeWabaToApp,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';

export interface PersistWhatsAppConfigInput {
  supabase: SupabaseClient;
  userId: string;
  accountId: string;
  phone_number_id: string;
  waba_id?: string | null;
  access_token: string;
  verify_token?: string | null;
  pin?: string | null;
}

export type PersistWhatsAppConfigResult =
  | {
      ok: true;
      registered: boolean;
      registration_skipped: boolean;
      registration_error?: string;
      phone_info: Awaited<ReturnType<typeof verifyPhoneNumber>>;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export async function persistWhatsAppConfig(
  input: PersistWhatsAppConfigInput,
): Promise<PersistWhatsAppConfigResult> {
  const {
    supabase,
    userId,
    accountId,
    phone_number_id,
    waba_id,
    access_token,
    verify_token,
    pin,
  } = input;

  if (pin !== undefined && pin !== null && pin !== '') {
    if (typeof pin !== 'string' || !/^\d{6}$/.test(pin)) {
      return { ok: false, status: 400, error: 'PIN must be exactly 6 digits.' };
    }
  }

  const { data: claimed, error: claimedError } = await supabaseAdmin()
    .from('whatsapp_config')
    .select('account_id')
    .eq('phone_number_id', phone_number_id)
    .neq('account_id', accountId)
    .maybeSingle();

  if (claimedError) {
    console.error('Error checking phone_number_id ownership:', claimedError);
    return { ok: false, status: 500, error: 'Failed to validate configuration' };
  }

  if (claimed) {
    return {
      ok: false,
      status: 409,
      error:
        'This WhatsApp phone number is already linked to another account on this instance. Each phone number can only be connected to one wacrm user.',
    };
  }

  let phoneInfo;
  try {
    phoneInfo = await verifyPhoneNumber({
      phoneNumberId: phone_number_id,
      accessToken: access_token,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown Meta API error';
    console.error('Meta API verification failed during save:', message);
    return { ok: false, status: 400, error: `Meta API error: ${message}` };
  }

  let encryptedAccessToken: string;
  let encryptedVerifyToken: string | null;
  try {
    encryptedAccessToken = encrypt(access_token);
    encryptedVerifyToken = verify_token ? encrypt(verify_token) : null;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown encryption error';
    console.error('Encryption failed:', message);
    return {
      ok: false,
      status: 500,
      error:
        'Failed to encrypt token. Check that ENCRYPTION_KEY is a valid 64-character hex string in your environment variables.',
    };
  }

  const { data: existing } = await supabase
    .from('whatsapp_config')
    .select('id, registered_at, phone_number_id')
    .eq('account_id', accountId)
    .maybeSingle();

  const sameNumber =
    existing?.phone_number_id === phone_number_id && existing?.registered_at != null;

  let registeredAt: string | null = existing?.registered_at ?? null;
  let registrationError: string | null = null;
  let registrationSkipped = false;

  const needsRegistration = !sameNumber || (typeof pin === 'string' && pin.length > 0);
  if (needsRegistration) {
    if (!pin) {
      registrationSkipped = true;
    } else {
      try {
        await registerPhoneNumber({
          phoneNumberId: phone_number_id,
          accessToken: access_token,
          pin,
        });
        registeredAt = new Date().toISOString();
      } catch (err) {
        registrationError =
          err instanceof Error ? err.message : 'Unknown Meta API error';
        console.error('Phone number /register failed:', registrationError);
      }
    }
  }

  let subscribedAppsAt: string | null = null;
  if (waba_id) {
    try {
      await subscribeWabaToApp({
        wabaId: waba_id,
        accessToken: access_token,
      });
      subscribedAppsAt = new Date().toISOString();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn('WABA subscribed_apps failed (non-fatal):', message);
    }
  }

  const baseRow = {
    phone_number_id,
    waba_id: waba_id || null,
    access_token: encryptedAccessToken,
    verify_token: encryptedVerifyToken,
    status: registrationError ? 'disconnected' : 'connected',
    connected_at: registrationError ? null : new Date().toISOString(),
    registered_at: registrationError ? null : registeredAt,
    subscribed_apps_at: subscribedAppsAt ?? null,
    last_registration_error: registrationError,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error: updateError } = await supabase
      .from('whatsapp_config')
      .update(baseRow)
      .eq('account_id', accountId);

    if (updateError) {
      console.error('Error updating whatsapp_config:', updateError);
      return { ok: false, status: 500, error: 'Failed to update configuration' };
    }
  } else {
    const { error: insertError } = await supabase
      .from('whatsapp_config')
      .insert({
        account_id: accountId,
        user_id: userId,
        ...baseRow,
      });

    if (insertError) {
      console.error('Error inserting whatsapp_config:', insertError);
      return { ok: false, status: 500, error: 'Failed to save configuration' };
    }
  }

  if (registrationError) {
    return {
      ok: true,
      registered: false,
      registration_skipped: false,
      registration_error: registrationError,
      phone_info: phoneInfo,
    };
  }

  return {
    ok: true,
    registered: registeredAt != null,
    registration_skipped: registrationSkipped,
    phone_info: phoneInfo,
  };
}
