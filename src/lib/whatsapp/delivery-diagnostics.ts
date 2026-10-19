import type { SupabaseClient } from '@supabase/supabase-js';

export interface ApiDeliveryTiming {
  started_at: string;
  accepted_at: string;
  duration_ms: number;
  message_status: string | null;
}
export interface DeliveryEvent {
  message_id: string;
  event_type: string;
  occurred_at: string;
  received_at: string;
  details: {
    api_started_at?: string;
    api_duration_ms?: number;
    message_status?: string | null;
  };
}

/** Diagnostics must never turn a successfully sent message into a retry. */
export async function recordDeliveryEvent(
  db: SupabaseClient,
  row: {
    account_id: string;
    phone_number_id: string;
    message_id: string;
    event_type: string;
    occurred_at: string;
    received_at?: string;
    details?: Record<string, unknown>;
  }
) {
  try {
    const { error } = await db.from('message_delivery_events').upsert(row, {
      onConflict:
        'account_id,phone_number_id,message_id,event_type,occurred_at',
      ignoreDuplicates: true,
    });
    if (error)
      console.error(
        '[delivery-diagnostics] could not record timing:',
        error.code
      );
  } catch {
    console.error('[delivery-diagnostics] could not record timing');
  }
}

export async function recordApiAcceptance(
  db: SupabaseClient,
  accountId: string,
  phoneNumberId: string,
  messageId: string,
  timing?: ApiDeliveryTiming
) {
  if (!timing) return;
  await recordDeliveryEvent(db, {
    account_id: accountId,
    phone_number_id: phoneNumberId,
    message_id: messageId,
    event_type: 'api_accepted',
    occurred_at: timing.accepted_at,
    details: {
      api_started_at: timing.started_at,
      api_duration_ms: timing.duration_ms,
      message_status: timing.message_status,
    },
  });
}

export async function recordDeliveryStatus(
  db: SupabaseClient,
  phoneNumberId: string,
  status: { id: string; status: string; timestamp: string },
  receivedAt = new Date().toISOString()
) {
  if (
    !['sent', 'delivered', 'read', 'failed'].includes(status.status) ||
    !/^\d+$/.test(status.timestamp)
  )
    return;
  const date = new Date(Number(status.timestamp) * 1000);
  if (!Number.isFinite(date.getTime())) return;
  try {
    const { data, error } = await db
      .from('whatsapp_config')
      .select('account_id')
      .eq('phone_number_id', phoneNumberId)
      .maybeSingle();
    if (error || !data?.account_id) return;
    await recordDeliveryEvent(db, {
      account_id: data.account_id,
      phone_number_id: phoneNumberId,
      message_id: status.id,
      event_type: status.status,
      occurred_at: date.toISOString(),
      received_at: receivedAt,
    });
  } catch {
    console.error('[delivery-diagnostics] could not resolve WhatsApp account');
  }
}

export function deliveryDurations(events: DeliveryEvent[]) {
  const earliest = (type: string) =>
    events
      .filter((e) => e.event_type === type)
      .map((e) => Date.parse(e.occurred_at))
      .filter(Number.isFinite)
      .sort((a, b) => a - b)[0];
  const accepted = earliest('api_accepted');
  const delivered = earliest('delivered');
  return {
    acceptedToDeliveredMs:
      accepted !== undefined && delivered !== undefined
        ? Math.max(0, delivered - accepted)
        : null,
  };
}
