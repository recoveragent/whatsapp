/**
 * Handler for the WhatsApp `account_update` webhook field.
 *
 * Meta sends it when this app loses a WABA: the business uninstalls the
 * app, removes the partner, or a coexistence number is offboarded (e.g.
 * the WhatsApp Business app went unopened for 14 days). Without this the
 * brand only finds out when customers stop getting replies.
 *
 * Subscribe to `account_update` in Meta App Dashboard → WhatsApp →
 * Configuration → Webhook fields.
 *
 * Events are confirmed against Meta before acting, so a stray or
 * out-of-order event can't take a working number offline. Credentials
 * are kept so the brand can reconnect the same number via Embedded
 * Signup (persist-config clears the disconnect markers on success).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { decrypt } from '@/lib/whatsapp/encryption';
import {
  classifyMetaAccessError,
  verifyPhoneNumber,
} from '@/lib/whatsapp/meta-api';

export const ACCOUNT_UPDATE_WEBHOOK_FIELD = 'account_update';

export function isAccountUpdateWebhookField(field: string): boolean {
  return field === ACCOUNT_UPDATE_WEBHOOK_FIELD;
}

const DISCONNECT_REASONS: Record<string, string> = {
  PARTNER_APP_UNINSTALLED:
    'Meta reports that Recover Agent was uninstalled from this WhatsApp Business account.',
  PARTNER_REMOVED:
    'Meta reports that Recover Agent was removed as a partner on this WhatsApp Business account.',
  ACCOUNT_OFFBOARDED:
    'Meta disconnected this number from the WhatsApp Business app connection. This happens when the WhatsApp Business app on the phone is not opened for 14 days, or the business platform is disconnected from the phone.',
  ACCOUNT_DELETED:
    'Meta reports that this WhatsApp Business account was deleted.',
};

export function disconnectReasonForEvent(event: string): string | null {
  return DISCONNECT_REASONS[event] ?? null;
}

export interface AccountUpdateWebhookChange {
  /** `entry.id` — the WABA id for WhatsApp Business Account webhooks. */
  entryId?: string;
  value: unknown;
}

interface ConfigRow {
  id: string;
  account_id: string;
  phone_number_id: string;
  access_token: string;
  meta_disconnected_at: string | null;
}

export interface AccountUpdateDeps {
  /** Resolves when Meta still lets this app read the number. */
  confirmAccess?: (config: ConfigRow) => Promise<unknown>;
  /** Our Meta app id, to ignore uninstalls of other partners' apps. */
  appId?: string;
  now?: () => Date;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const defaultConfirmAccess = (config: ConfigRow) =>
  verifyPhoneNumber({
    phoneNumberId: config.phone_number_id,
    accessToken: decrypt(config.access_token),
  });

export async function handleAccountUpdateWebhookChange(
  change: AccountUpdateWebhookChange,
  db: SupabaseClient,
  deps: AccountUpdateDeps = {},
): Promise<void> {
  const value = asRecord(change.value);
  const event = typeof value?.event === 'string' ? value.event : '';
  const reason = disconnectReasonForEvent(event);
  if (!value || !reason) return;

  const wabaInfo = asRecord(value.waba_info);
  const wabaId =
    (typeof wabaInfo?.waba_id === 'string' && wabaInfo.waba_id) || change.entryId;
  if (!wabaId) {
    console.warn('[account-update-webhook] missing waba id for', event);
    return;
  }

  const appId = deps.appId ?? process.env.NEXT_PUBLIC_META_APP_ID;
  const partnerAppId =
    wabaInfo?.partner_app_id != null ? String(wabaInfo.partner_app_id) : null;
  if (event === 'PARTNER_APP_UNINSTALLED' && partnerAppId && appId && partnerAppId !== appId) {
    return;
  }

  const { data, error } = await db
    .from('whatsapp_config')
    .select('id, account_id, phone_number_id, access_token, meta_disconnected_at')
    .eq('waba_id', wabaId)
    .neq('access_token', '');
  if (error) {
    console.error('[account-update-webhook] config lookup failed:', error.message);
    return;
  }

  const confirmAccess = deps.confirmAccess ?? defaultConfirmAccess;
  const now = (deps.now ?? (() => new Date()))().toISOString();

  for (const config of (data ?? []) as ConfigRow[]) {
    if (config.meta_disconnected_at) continue;

    try {
      await confirmAccess(config);
      console.info(
        `[account-update-webhook] ${event} for WABA ${wabaId}, but Meta still grants access to ${config.phone_number_id}; ignoring`,
      );
      continue;
    } catch (err) {
      if (classifyMetaAccessError(err) !== 'access_revoked') {
        console.warn(
          `[account-update-webhook] ${event} for WABA ${wabaId}; access check inconclusive:`,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
    }

    const { data: marked, error: updateError } = await db
      .from('whatsapp_config')
      .update({
        status: 'disconnected',
        meta_disconnected_at: now,
        meta_disconnect_reason: reason,
        updated_at: now,
      })
      .eq('id', config.id)
      .is('meta_disconnected_at', null)
      .select('id');
    if (updateError) {
      console.error('[account-update-webhook] mark disconnected failed:', updateError.message);
      continue;
    }
    // Another delivery of the same event already handled it.
    if (!marked?.length) continue;

    await notifyBrandAdmins(db, config.account_id, reason);
  }
}

async function notifyBrandAdmins(
  db: SupabaseClient,
  accountId: string,
  reason: string,
): Promise<void> {
  const { data: account } = await db
    .from('accounts')
    .select('id, parent_brand_id')
    .eq('id', accountId)
    .maybeSingle();
  const brandId = (account?.parent_brand_id as string | null) ?? accountId;

  const { data: admins, error } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', brandId)
    .in('account_role', ['owner', 'admin']);
  if (error) {
    console.error('[account-update-webhook] admin lookup failed:', error.message);
    return;
  }

  const recipients = [...new Set((admins ?? []).map((a) => a.user_id as string))];
  if (!recipients.length) return;

  const { error: insertError } = await db.from('notifications').insert(
    recipients.map((userId) => ({
      account_id: accountId,
      user_id: userId,
      type: 'whatsapp_disconnected',
      title: 'WhatsApp number disconnected',
      body: `${reason} Messages are not being sent or received. Open Settings → WhatsApp and reconnect the same number.`,
    })),
  );
  if (insertError) {
    console.error('[account-update-webhook] notification insert failed:', insertError.message);
  }
}
