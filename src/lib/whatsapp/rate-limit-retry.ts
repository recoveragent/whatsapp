import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from './encryption';
import { META_API_VERSION } from './meta-api';
import { canonicalContactPhone, normalizePhone, phonesMatch } from './phone-utils';

/**
 * Meta error 130429 ("Rate limit hit") is a temporary, per-number throughput
 * rejection that usually arrives asynchronously on the status webhook after
 * the send was accepted. Meta's guidance is to retry later with backoff, so
 * template sends are snapshotted at send time and resent from the cron.
 */
export const RATE_LIMIT_ERROR_CODE = 130429;
export const RATE_LIMIT_MAX_RESENDS = 3;
/** Wait before resend #1, #2, #3. */
export const RATE_LIMIT_RETRY_DELAYS_MS = [
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
] as const;
const JITTER_MS = 30_000;
const TRACKING_TTL_MS = 3 * 24 * 60 * 60_000;
const HISTORY_TTL_MS = 30 * 24 * 60 * 60_000;
const BATCH_SIZE = 50;

type StatusError = { code?: number };

export function isRateLimitFailure(errors: StatusError[] | undefined | null): boolean {
  return (
    Array.isArray(errors) &&
    errors.some((e) => Number(e?.code) === RATE_LIMIT_ERROR_CODE)
  );
}

/** Next attempt time after `attempts` resends so far, or null when exhausted. */
export function nextRetryAt(
  attempts: number,
  nowMs: number = Date.now(),
  random: () => number = Math.random,
): string | null {
  if (attempts >= RATE_LIMIT_MAX_RESENDS) return null;
  const delay = RATE_LIMIT_RETRY_DELAYS_MS[attempts];
  return new Date(nowMs + delay + Math.floor(random() * JITTER_MS)).toISOString();
}

async function scheduleOrGiveUp(
  db: SupabaseClient,
  row: { id: string; attempts: number },
  fromStatuses: string[],
) {
  const at = nextRetryAt(row.attempts);
  await db
    .from('rate_limit_retries')
    .update(
      at
        ? {
            status: 'scheduled',
            next_attempt_at: at,
            error_message: `Meta ${RATE_LIMIT_ERROR_CODE} rate limit; resend scheduled`,
            updated_at: new Date().toISOString(),
          }
        : {
            status: 'failed',
            next_attempt_at: null,
            error_message: `Meta ${RATE_LIMIT_ERROR_CODE} rate limit after ${row.attempts} resends`,
            updated_at: new Date().toISOString(),
          },
    )
    .eq('id', row.id)
    .in('status', fromStatuses);
}

/**
 * Snapshot an accepted template send. Called from the shared template
 * transport; never throws into the caller's send path (caller catches).
 */
export async function trackTemplateForRateLimitRetry(
  phoneNumberId: string,
  payload: Record<string, unknown>,
  messageId: string,
) {
  const db = supabaseAdmin();
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id, account_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!config) return;

  const sent = payload.template as
    | { name?: string; language?: { code?: string } }
    | undefined;
  let category: string | null = null;
  if (sent?.name) {
    const { data: template } = await db
      .from('message_templates')
      .select('category')
      .eq('account_id', config.account_id)
      .eq('whatsapp_config_id', config.id)
      .eq('name', sent.name)
      .eq('language', sent.language?.code ?? '')
      .limit(1)
      .maybeSingle();
    category = (template?.category as string | undefined) ?? null;
  }

  const { data: row, error } = await db
    .from('rate_limit_retries')
    .insert({
      account_id: config.account_id,
      whatsapp_config_id: config.id,
      recipient: canonicalContactPhone(String(payload.to)),
      original_message_id: messageId,
      current_message_id: messageId,
      payload,
      template_category: category,
    })
    .select('id, attempts')
    .single();
  if (error) throw error;

  // The status webhook can land before this insert. It records delivery
  // events first, so re-read them to close that race.
  const { data: early } = await db
    .from('message_delivery_events')
    .select('event_type, details')
    .eq('account_id', config.account_id)
    .eq('phone_number_id', phoneNumberId)
    .eq('message_id', messageId)
    .in('event_type', ['failed', 'delivered', 'read'])
    .limit(20);
  if (early?.some((e) => e.event_type === 'delivered' || e.event_type === 'read')) {
    await db.from('rate_limit_retries').delete().eq('id', row.id).eq('status', 'tracking');
  } else if (
    early?.some(
      (e) =>
        e.event_type === 'failed' &&
        isRateLimitFailure((e.details as { errors?: StatusError[] } | null)?.errors),
    )
  ) {
    await scheduleOrGiveUp(db, row as { id: string; attempts: number }, ['tracking']);
  }
}

/** Status webhook hook: schedule resends on 130429, settle on delivery. */
export async function handleRateLimitStatus(
  db: SupabaseClient,
  phoneNumberId: string,
  status: { id: string; status: string; errors?: StatusError[] },
) {
  if (!['failed', 'delivered', 'read'].includes(status.status)) return;
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!config) return;

  const { data: row } = await db
    .from('rate_limit_retries')
    .select('id, attempts, status')
    .eq('whatsapp_config_id', config.id)
    .eq('current_message_id', status.id)
    .maybeSingle();
  if (!row) return;

  if (status.status === 'failed') {
    if (isRateLimitFailure(status.errors)) {
      await scheduleOrGiveUp(db, row as { id: string; attempts: number }, [
        'tracking',
        'resent',
      ]);
    } else if (row.status === 'resent') {
      await db
        .from('rate_limit_retries')
        .update({
          status: 'failed',
          error_message: `Resend failed (${(status.errors ?? []).map((e) => e.code ?? 'unknown').join(', ') || 'no detail'})`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'resent');
    } else {
      // A different failure on the first attempt: nothing to retry.
      await db.from('rate_limit_retries').delete().eq('id', row.id).eq('status', 'tracking');
    }
    return;
  }

  // delivered / read
  if (row.status === 'tracking') {
    await db.from('rate_limit_retries').delete().eq('id', row.id).eq('status', 'tracking');
  } else if (row.status === 'resent') {
    await db
      .from('rate_limit_retries')
      .update({ status: 'delivered', error_message: null, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'resent');
  }
}

function phoneSuffix(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return normalized.length >= 10 ? normalized.slice(-10) : normalized;
}

/** Marketing resends (e.g. abandoned checkout) are pointless once the customer ordered. */
async function customerOrderedSince(
  db: SupabaseClient,
  accountId: string,
  recipient: string,
  sinceIso: string,
): Promise<boolean> {
  const suffix = phoneSuffix(recipient);
  if (!suffix) return false;
  const { data, error } = await db
    .from('shopify_orders')
    .select('customer_phone')
    .eq('account_id', accountId)
    .like('customer_phone', `%${suffix}`)
    .gte('ordered_at', sinceIso)
    .or('order_status.is.null,order_status.neq.cancelled')
    .limit(20);
  if (error) {
    console.error('[rate-limit-retry] order check failed:', error.message);
    return false;
  }
  return (data ?? []).some(
    (o) => !!o.customer_phone && phonesMatch(String(o.customer_phone), recipient),
  );
}

class ResendError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

async function resend(
  config: { phone_number_id: string; access_token: string },
  payload: Record<string, unknown>,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${config.phone_number_id}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${decrypt(config.access_token)}`,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15000),
      },
    );
  } catch (error) {
    throw new ResendError(
      error instanceof Error ? error.message : 'network error',
      null,
      true,
    );
  }
  const result = (await response.json().catch(() => ({}))) as {
    messages?: { id?: string }[];
    error?: { code?: number; message?: string };
  };
  const id = result.messages?.[0]?.id;
  if (response.ok && id) return id;
  const code = result.error?.code ?? null;
  throw new ResendError(
    `Resend rejected (${code ?? response.status})${result.error?.message ? `: ${result.error.message}` : ''}`,
    code,
    code === RATE_LIMIT_ERROR_CODE || response.status >= 500,
  );
}

/** Re-point inbox / campaign rows from the failed wamid to the resend. */
async function relinkMessageId(
  db: SupabaseClient,
  accountId: string,
  configId: string,
  oldId: string,
  newId: string,
) {
  // message_id is only unique per number, so scope through conversations.
  const { data: rows } = await db
    .from('messages')
    .select('id, conversations!inner(account_id, whatsapp_config_id)')
    .eq('conversations.account_id', accountId)
    .eq('conversations.whatsapp_config_id', configId)
    .eq('message_id', oldId);
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length) {
    await db
      .from('messages')
      .update({ message_id: newId, status: 'sent', error_message: null })
      .in('id', ids);
  }

  await db
    .from('shopify_message_log')
    .update({ whatsapp_message_id: newId })
    .eq('account_id', accountId)
    .eq('whatsapp_message_id', oldId);

  const { data: broadcasts } = await db
    .from('broadcasts')
    .select('id')
    .eq('account_id', accountId);
  if (broadcasts?.length) {
    const { data: recovered } = await db
      .from('broadcast_recipients')
      .update({ whatsapp_message_id: newId, status: 'sent', error_message: null })
      .in(
        'broadcast_id',
        broadcasts.map((b) => b.id),
      )
      .eq('whatsapp_message_id', oldId)
      .eq('status', 'failed')
      .select('broadcast_id');
    if (recovered?.length) {
      const { finalizeBroadcastStatus } = await import('./broadcast-core');
      for (const id of new Set(recovered.map((r) => r.broadcast_id as string)))
        await finalizeBroadcastStatus(db, id);
    }
  }
}

/** Cron: resend due 130429 failures. Returns the number of resends accepted by Meta. */
export async function processDueRateLimitRetries(db: SupabaseClient): Promise<number> {
  const now = Date.now();
  // Housekeeping: snapshots that never failed, and old history.
  await db
    .from('rate_limit_retries')
    .delete()
    .eq('status', 'tracking')
    .lt('created_at', new Date(now - TRACKING_TTL_MS).toISOString());
  await db
    .from('rate_limit_retries')
    .delete()
    .lt('created_at', new Date(now - HISTORY_TTL_MS).toISOString());

  const { data: due, error } = await db
    .from('rate_limit_retries')
    .select('*')
    .eq('status', 'scheduled')
    .lte('next_attempt_at', new Date(now).toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH_SIZE);
  if (error) throw new Error(error.message);

  let resent = 0;
  for (const row of due ?? []) {
    // Conditional UPDATE is the claim: overlapping cron runs cannot double-send.
    const { data: claim } = await db
      .from('rate_limit_retries')
      .update({ status: 'sending', updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'scheduled')
      .select('id')
      .maybeSingle();
    if (!claim) continue;

    const finish = (values: Record<string, unknown>) =>
      db
        .from('rate_limit_retries')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', row.id)
        .eq('status', 'sending');

    try {
      const { data: config } = await db
        .from('whatsapp_config')
        .select('id, phone_number_id, access_token, status')
        .eq('id', row.whatsapp_config_id)
        .eq('account_id', row.account_id)
        .maybeSingle();
      if (!config?.access_token || config.status === 'disconnected') {
        await finish({ status: 'failed', error_message: 'WhatsApp number disconnected' });
        continue;
      }

      if (
        row.template_category === 'Marketing' &&
        (await customerOrderedSince(db, row.account_id, row.recipient, row.created_at))
      ) {
        await finish({ status: 'skipped', error_message: 'Customer placed an order since the original send' });
        continue;
      }

      const attempts = Number(row.attempts) + 1;
      const failedMessageId = String(row.current_message_id);
      let newId: string;
      try {
        // Not billed again: the failed attempt was already debited and Meta
        // does not charge for undelivered messages.
        newId = await resend(config, row.payload as Record<string, unknown>);
      } catch (err) {
        const e = err as ResendError;
        if (e.retryable) {
          const at = nextRetryAt(attempts);
          await finish(
            at
              ? { status: 'scheduled', attempts, next_attempt_at: at, error_message: e.message }
              : { status: 'failed', attempts, next_attempt_at: null, error_message: e.message },
          );
        } else {
          await finish({ status: 'failed', attempts, next_attempt_at: null, error_message: e.message });
        }
        continue;
      }

      await finish({
        status: 'resent',
        attempts,
        current_message_id: newId,
        next_attempt_at: null,
        error_message: null,
      });
      resent++;
      try {
        await relinkMessageId(db, row.account_id, row.whatsapp_config_id, failedMessageId, newId);
      } catch (linkError) {
        console.error('[rate-limit-retry] relink failed:', linkError);
      }
    } catch (unexpected) {
      console.error('[rate-limit-retry] resend failed:', unexpected);
      await finish({
        status: 'failed',
        error_message: unexpected instanceof Error ? unexpected.message : 'Resend failed',
      });
    }
  }
  return resent;
}
