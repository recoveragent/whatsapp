import 'server-only';
import { paymentTemplateError, paymentOrigins } from './template-compatibility';
import {
  cashfreeRequest,
  normalizeCashfreeLink,
  type CashfreeCredentials,
  type CashfreeLink,
} from './cashfree';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import type {
  FlowNodeRow,
  FlowRunRow,
  SendTemplateNodeConfig,
} from '@/lib/flows/types';
import { executeExtendedNode } from '@/lib/flows/extended-nodes';
import { interpolateTemplateString } from '@/lib/flows/template-interpolate';
import {
  paymentConfigErrors,
  type CollectPaymentNodeConfig,
} from '@/lib/flows/payment-config';
import {
  razorpayRequest,
  verifiedLinkOutcome,
  type PaymentLink,
  type RazorpayCredentials,
} from './razorpay';

export interface CollectionRow {
  id: string;
  account_id: string;
  flow_run_id: string;
  node_key: string;
  provider_link_id: string;
  amount_paise: number;
  payment_url: string;
  status: string;
  expires_at: string;
  next_check_at: string;
  reminder_at: string;
  reminders_sent: number;
  config: CollectPaymentNodeConfig;
  reminder_claimed_at: string | null;
}

export async function paymentCredentials(
  db: SupabaseClient,
  accountId: string
): Promise<RazorpayCredentials> {
  const { data, error } = await db
    .from('account_payment_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      'Connect this brand’s Razorpay account before collecting payments.'
    );
  return {
    key_id: data.key_id,
    key_secret: decrypt(data.key_secret_encrypted),
    webhook_secret: decrypt(data.webhook_secret_encrypted),
  };
}

export async function cashfreeCredentials(
  db: SupabaseClient,
  accountId: string
): Promise<CashfreeCredentials> {
  const { data, error } = await db
    .from('account_cashfree_connections')
    .select('*')
    .eq('account_id', accountId)
    .eq('enabled', true)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      'Connect this brand’s Cashfree account before collecting payments.'
    );
  return {
    client_id: data.client_id,
    client_secret: decrypt(data.client_secret_encrypted),
    environment: data.environment,
  };
}

export async function sendPaymentTemplate(
  db: SupabaseClient,
  run: FlowRunRow,
  nodeKey: string,
  config: SendTemplateNodeConfig
) {
  const result = await executeExtendedNode(db, run, {
    node_key: nodeKey,
    node_type: 'send_template',
    config: { ...config, buttons: [], next_node_key: '' },
  } as unknown as FlowNodeRow);
  if (result.kind === 'error') throw new Error(result.message);
}

export async function beginPaymentCollection(
  db: SupabaseClient,
  run: FlowRunRow,
  node: FlowNodeRow
): Promise<void> {
  const c = node.config as unknown as CollectPaymentNodeConfig;
  const invalid = paymentConfigErrors(node.config);
  if (invalid.length) throw new Error(invalid[0].message);
  if (!run.contact_id) throw new Error('Payment collection needs a contact.');
  const credentials =
    c.provider === 'cashfree'
      ? await cashfreeCredentials(db, run.account_id)
      : await paymentCredentials(db, run.account_id);
  const origins = paymentOrigins(
    c.provider,
    c.provider === 'cashfree'
      ? (credentials as CashfreeCredentials).environment
      : undefined
  );
  for (const template of [
    c.request_template,
    ...(c.max_reminders > 0 ? [c.reminder_template] : []),
  ]) {
    const { data, error } = await db
      .from('message_templates')
      .select('buttons')
      .eq('account_id', run.account_id)
      .eq('name', template.template_name)
      .eq('language', template.language || 'en_US')
      .eq('status', 'APPROVED')
      .maybeSingle();
    if (error || !data)
      throw new Error(
        'Select an approved payment template for this brand before collecting payments.'
      );
    const incompatible = paymentTemplateError(
      data.buttons,
      template.variables ?? {},
      origins
    );
    if (incompatible) throw new Error(incompatible);
  }
  const { data: contact, error: contactError } = await db
    .from('contacts')
    .select('phone, name, email')
    .eq('id', run.contact_id)
    .eq('account_id', run.account_id)
    .single();
  if (contactError || !contact?.phone)
    throw new Error('Payment contact is unavailable.');
  const id = randomUUID();
  const now = Date.now();
  const reminderMinutes =
    Number.isFinite(c.reminder_minutes) && c.reminder_minutes > 0
      ? c.reminder_minutes
      : 60;
  const expiresAt = new Date(now + c.expiry_hours * 3_600_000).toISOString();
  const description = interpolateTemplateString(c.description, run.vars).slice(
    0,
    255
  );
  const { error: insertError } = await db.from('flow_payment_requests').insert({
    id,
    account_id: run.account_id,
    flow_run_id: run.id,
    node_key: node.node_key,
    amount_paise: Math.round(c.amount * 100),
    config: c,
    expires_at: expiresAt,
    reminder_at: new Date(now + reminderMinutes * 60_000).toISOString(),
    next_check_at: new Date(now + 60_000).toISOString(),
  });
  // Another invocation owns this run/node. It must finish parking or failing it;
  // the duplicate must not create a second link or follow the failure branch.
  if (insertError?.code === '23505') return;
  if (insertError)
    throw new Error(
      'This run already has a payment request, or the request could not be saved.'
    );
  try {
    const link =
      c.provider === 'cashfree'
        ? normalizeCashfreeLink(
            await cashfreeRequest<CashfreeLink>(
              credentials as CashfreeCredentials,
              'links',
              {
                link_id: id,
                link_amount: c.amount,
                link_currency: 'INR',
                link_purpose: description,
                link_expiry_time: expiresAt,
                link_meta: { upi_intent: c.cashfree_checkout !== 'hosted' },
                link_partial_payments: false,
                link_auto_reminders: false,
                link_notify: {
                  send_sms: false,
                  send_email: false,
                  send_whatsapp: false,
                },
                customer_details: {
                  customer_name: contact.name || undefined,
                  customer_phone: contact.phone
                    .replace(/\D/g, '')
                    .replace(/^91(?=\d{10}$)/, ''),
                  customer_email: contact.email || undefined,
                },
              },
              id
            )
          )
        : await razorpayRequest<PaymentLink>(
            credentials as RazorpayCredentials,
            'payment_links',
            {
              amount: Math.round(c.amount * 100),
              currency: 'INR',
              accept_partial: false,
              description,
              reference_id: id,
              expire_by: Math.floor(Date.parse(expiresAt) / 1000),
              customer: {
                name: contact.name || undefined,
                contact: contact.phone,
                email: contact.email || undefined,
              },
              notify: { sms: false, email: false },
              reminder_enable: false,
              notes: { collection_id: id, flow_run_id: run.id },
            }
          );
    if (!link.id || !link.short_url?.startsWith('https://'))
      throw new Error('The gateway did not return a payment link.');
    const vars = {
      ...run.vars,
      payment_url: link.short_url,
      payment_url_suffix: new URL(link.short_url).pathname.slice(1),
      payment_amount: c.amount.toFixed(2),
      payment_currency: 'INR',
      payment_description: description,
      payment_reference: id,
      payment_collection_status: 'pending',
    };
    const { error: saved } = await db
      .from('flow_payment_requests')
      .update({
        provider_link_id: link.id,
        payment_url: link.short_url,
        status: 'pending',
      })
      .eq('id', id);
    if (saved) throw saved;
    // Persist link context before sending; callbacks only advance runs parked at this node.
    const { error: varsError } = await db
      .from('flow_runs')
      .update({ vars })
      .eq('id', run.id)
      .eq('account_id', run.account_id);
    if (varsError) throw varsError;
    run.vars = vars;
    try {
      await sendPaymentTemplate(db, run, node.node_key, c.request_template);
    } catch (sendError) {
      // A link that may have reached the customer still needs reconciliation.
      // A delivery failure must never make a payable link disappear from tracking.
      await db
        .from('flow_payment_requests')
        .update({
          last_error:
            sendError instanceof Error
              ? sendError.message
              : 'Payment request delivery failed',
        })
        .eq('id', id);
      await db.from('flow_run_events').insert({
        flow_run_id: run.id,
        event_type: 'error',
        node_key: node.node_key,
        payload: {
          reason: 'payment_request_delivery_failed',
          detail:
            sendError instanceof Error
              ? sendError.message
              : 'Unknown delivery error',
        },
      });
    }
    const { data: parked, error: parkError } = await db
      .from('flow_runs')
      .update({
        status: 'waiting',
        current_node_key: node.node_key,
        last_advanced_at: new Date().toISOString(),
      })
      .eq('id', run.id)
      .eq('status', 'active')
      .select('id')
      .maybeSingle();
    if (parkError) throw new Error('Payment run could not be parked.');
    // An agent can stop the run while the request is being sent. Do not revive it.
    if (!parked) return;
  } catch (error) {
    await db
      .from('flow_payment_requests')
      .update({
        last_error:
          error instanceof Error ? error.message : 'Payment setup failed',
      })
      .eq('id', id)
      .in('status', ['creating', 'pending']);
    await db
      .from('flow_payment_requests')
      .update({ status: 'failed' })
      .eq('id', id)
      .eq('status', 'creating');
    throw error;
  }
}

export async function reconcilePayment(
  db: SupabaseClient,
  row: CollectionRow
): Promise<PaymentLink> {
  const link =
    row.config.provider === 'cashfree'
      ? normalizeCashfreeLink(
          await cashfreeRequest<CashfreeLink>(
            await cashfreeCredentials(db, row.account_id),
            `links/${encodeURIComponent(row.provider_link_id)}`
          )
        )
      : await razorpayRequest<PaymentLink>(
          await paymentCredentials(db, row.account_id),
          `payment_links/${encodeURIComponent(row.provider_link_id)}`
        );
  const outcome = verifiedLinkOutcome(link, row);
  if (outcome) {
    const { error } = await db.rpc('resolve_flow_payment', {
      p_request_id: row.id,
      p_outcome: outcome,
    });
    if (error) throw error;
  }
  return link;
}

/** Shared by both flows cron methods. Polling also recovers missed webhooks. */
export async function processPaymentCollections(
  db: SupabaseClient
): Promise<number> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('flow_payment_requests')
    .select('*')
    .eq('status', 'pending')
    .lte('next_check_at', now)
    .order('next_check_at')
    .limit(50);
  if (error) throw error;
  let processed = 0;
  for (const row of (data ?? []) as CollectionRow[]) {
    try {
      const link = await reconcilePayment(db, row);
      if (verifiedLinkOutcome(link, row)) {
        processed++;
        continue;
      }
      const { data: runRow, error: runError } = await db
        .from('flow_runs')
        .select('*')
        .eq('id', row.flow_run_id)
        .eq('account_id', row.account_id)
        .single();
      if (runError) throw runError;
      if (
        runRow.status !== 'waiting' ||
        runRow.current_node_key !== row.node_key
      )
        continue;
      // Never remind after local expiry, even if Razorpay has not marked it expired yet.
      if (
        Date.parse(row.expires_at) > Date.now() &&
        Date.parse(row.reminder_at) <= Date.now() &&
        row.reminders_sent < row.config.max_reminders
      ) {
        const { data: claimed, error: claimError } = await db
          .from('flow_payment_requests')
          .update({ reminder_claimed_at: now })
          .eq('id', row.id)
          .eq('status', 'pending')
          .is('reminder_claimed_at', null)
          .eq('reminders_sent', row.reminders_sent)
          .select('id')
          .maybeSingle();
        if (claimError) throw claimError;
        if (claimed) {
          try {
            // Recheck with the provider after claiming: successful payments stop reminders.
            const fresh = await reconcilePayment(db, row);
            if (!verifiedLinkOutcome(fresh, row)) {
              await sendPaymentTemplate(
                db,
                runRow as FlowRunRow,
                row.node_key,
                row.config.reminder_template
              );
              const { error: reminderError } = await db
                .from('flow_payment_requests')
                .update({
                  reminders_sent: row.reminders_sent + 1,
                  reminder_at: new Date(
                    Date.now() + row.config.reminder_minutes * 60_000
                  ).toISOString(),
                  reminder_claimed_at: null,
                })
                .eq('id', row.id)
                .eq('status', 'pending');
              if (reminderError) throw reminderError;
            }
          } catch (err) {
            // Keep an ambiguous send claimed: never blindly duplicate a charged WhatsApp send.
            await db
              .from('flow_payment_requests')
              .update({
                last_error:
                  err instanceof Error ? err.message : 'Reminder failed',
              })
              .eq('id', row.id);
            await db.from('flow_run_events').insert({
              flow_run_id: row.flow_run_id,
              event_type: 'error',
              node_key: row.node_key,
              payload: {
                reason: 'payment_reminder_failed',
                detail:
                  err instanceof Error ? err.message : 'Unknown reminder error',
              },
            });
          }
        }
      }
      processed++;
    } catch (err) {
      await db
        .from('flow_payment_requests')
        .update({
          last_error:
            err instanceof Error ? err.message : 'Payment check failed',
        })
        .eq('id', row.id);
    } finally {
      await db
        .from('flow_payment_requests')
        .update({
          next_check_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        })
        .eq('id', row.id)
        .eq('status', 'pending');
    }
  }
  return processed;
}
