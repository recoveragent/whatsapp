import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { decrypt } from './encryption';
import { META_API_VERSION } from './meta-api';
import {
  assertWalletCanSend,
  debitWalletForTemplateSend,
} from '@/lib/wallet/billing';
import { isMessageTemplate } from './template-row-guard';
import type { MessageTemplate } from '@/types';
import { canonicalContactPhone } from './phone-utils';
import { ensureConversationForContact } from '@/lib/inbox/ensure-conversation';
import { persistOutboundAfterMetaSend } from './persist-outbound-message';

export const RECOVERY_PREFIX = 'smart_retry:';
export const isRecoveryPayload = (value: string | undefined): boolean =>
  !!value?.startsWith(RECOVERY_PREFIX);

// Deliberately narrow: fixed text, optionally one company-name variable,
// and one quick reply. Never silently reclassify a template as Utility.
export function promptTemplateError(
  template: MessageTemplate | null
): string | null {
  if (!template || template.status !== 'APPROVED')
    return 'Select an approved template.';
  if (!['Utility', 'Marketing'].includes(template.category))
    return 'Use a Utility or Marketing template with the appropriate approved category.';
  if (
    template.header_type &&
    (template.header_type !== 'text' || template.header_content?.includes('{{'))
  )
    return 'Use no header or a fixed text header.';
  if (
    template.buttons?.length !== 1 ||
    template.buttons[0]?.type !== 'QUICK_REPLY'
  )
    return 'The template must have exactly one quick-reply button (Receive message).';
  if (template.body_text.replaceAll('{{1}}', '').includes('{{'))
    return 'Only {{1}} (company name) is supported.';
  return null;
}

async function sendPayload(
  config: { phone_number_id: string; access_token: string },
  payload: Record<string, unknown>
): Promise<string> {
  const response = await fetch(
    `https://graph.facebook.com/${META_API_VERSION}/${config.phone_number_id}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${decrypt(config.access_token)}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    }
  );
  const result = await response.json();
  if (!response.ok || !result.messages?.[0]?.id)
    throw new Error(
      `Recovery send failed (${result.error?.code ?? response.status})`
    );
  return result.messages[0].id;
}

async function update(
  db: SupabaseClient,
  id: string,
  values: Record<string, unknown>
) {
  const { error } = await db
    .from('smart_retry_messages')
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) throw error;
}

/** Called at the common template transport, covering inbox, API, broadcasts and flows.
 * No credentials are stored in the snapshot. Recovery failure must never fail a send. */
export async function trackRecoverableTemplate(
  phoneNumberId: string,
  payload: Record<string, unknown>,
  messageId: string | null,
  errorCode?: number
) {
  const db = supabaseAdmin();
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id, account_id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!config) return;
  const { data: settings } = await db
    .from('smart_retry_settings')
    .select('*')
    .eq('whatsapp_config_id', config.id)
    .eq('enabled', true)
    .maybeSingle();
  if (!settings) return;
  const sentTemplate = payload.template as {
    name: string;
    language: { code: string };
  };
  const { data: template } = await db
    .from('message_templates')
    .select('id, category')
    .eq('account_id', config.account_id)
    .eq('whatsapp_config_id', config.id)
    .eq('name', sentTemplate.name)
    .eq('language', sentTemplate.language.code)
    .maybeSingle();
  if (
    template?.category !== 'Marketing' ||
    template.id === settings.template_id
  )
    return;
  const { data: row, error } = await db
    .from('smart_retry_messages')
    .insert({
      account_id: config.account_id,
      whatsapp_config_id: config.id,
      recipient: canonicalContactPhone(String(payload.to)),
      original_message_id: messageId,
      payload,
    })
    .select('id')
    .single();
  if (error) throw error;
  if (errorCode === 131049) await promptRecovery(db, row.id);
  else if (messageId) {
    // Meta may deliver its status webhook while the API caller is still
    // recording this snapshot. The webhook writes diagnostics before lookup;
    // reading them after INSERT closes that race without another send attempt.
    const { data: earlyEvents } = await db
      .from('message_delivery_events')
      .select('event_type, details')
      .eq('account_id', config.account_id)
      .eq('phone_number_id', phoneNumberId)
      .eq('message_id', messageId)
      .in('event_type', ['failed', 'delivered', 'read'])
      .limit(20);
    if (
      earlyEvents?.some((event) =>
        ['delivered', 'read'].includes(event.event_type)
      )
    ) {
      await update(db, row.id, { status: 'cancelled' });
    } else if (
      earlyEvents?.some(
        (event) =>
          event.event_type === 'failed' &&
          Array.isArray(event.details?.errors) &&
          event.details.errors.some(
            (failure: { code?: number }) => failure.code === 131049
          )
      )
    ) {
      await promptRecovery(db, row.id);
    }
  }
}

async function promptRecovery(db: SupabaseClient, id: string) {
  // Conditional UPDATE is the atomic claim: duplicate webhooks cannot send twice.
  const { data: row, error } = await db
    .from('smart_retry_messages')
    .update({ status: 'prompting' })
    .eq('id', id)
    .eq('status', 'tracking')
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!row) return;
  let promptAccepted = false;
  try {
    const { data: settings } = await db
      .from('smart_retry_settings')
      .select('*')
      .eq('whatsapp_config_id', row.whatsapp_config_id)
      .eq('enabled', true)
      .maybeSingle();
    const { data: config } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('id', row.whatsapp_config_id)
      .eq('account_id', row.account_id)
      .maybeSingle();
    if (!settings || !config || config.status === 'disconnected')
      throw new Error('Smart Retry disabled or number disconnected');
    const { data: template } = await db
      .from('message_templates')
      .select('*')
      .eq('id', settings.template_id)
      .eq('account_id', row.account_id)
      .eq('whatsapp_config_id', config.id)
      .maybeSingle();
    if (!isMessageTemplate(template) || promptTemplateError(template))
      throw new Error(
        promptTemplateError(template) ?? 'Invalid recovery template'
      );
    await assertWalletCanSend(row.account_id, template.category);
    const { data: claimed, error: claimError } = await db.rpc(
      'claim_smart_retry_prompt',
      { p_config_id: config.id, p_recipient: row.recipient }
    );
    if (claimError) throw claimError;
    if (!claimed) {
      await update(db, id, { status: 'suppressed' });
      return;
    }
    const components: Record<string, unknown>[] = [
      {
        type: 'button',
        sub_type: 'quick_reply',
        index: '0',
        parameters: [{ type: 'payload', payload: RECOVERY_PREFIX + row.id }],
      },
    ];
    if (template.body_text.includes('{{1}}'))
      components.unshift({
        type: 'body',
        parameters: [{ type: 'text', text: settings.company_name }],
      });
    const promptId = await sendPayload(config, {
      messaging_product: 'whatsapp',
      to: (row.payload as { to: string }).to,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language ?? 'en_US' },
        components,
      },
    });
    promptAccepted = true;
    const { error: completionError } = await db
      .from('smart_retry_messages')
      .update({
        status: 'awaiting_acceptance',
        prompt_message_id: promptId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'prompting');
    if (completionError) throw completionError;
    await debitWalletForTemplateSend({
      accountId: row.account_id,
      templateCategory: template.category,
      messageId: promptId,
      templateName: template.name,
    });
    const { data: contact } = await db
      .from('contacts')
      .select('id')
      .eq('account_id', row.account_id)
      .eq('phone_normalized', row.recipient)
      .maybeSingle();
    if (contact) {
      const conversation = await ensureConversationForContact(
        db,
        row.account_id,
        config.user_id,
        contact.id,
        { whatsappConfigId: config.id }
      );
      if (conversation)
        await persistOutboundAfterMetaSend(db, {
          conversation_id: conversation.id,
          sender_type: 'agent',
          content_type: 'template',
          content_text: template.body_text.replaceAll(
            '{{1}}',
            settings.company_name
          ),
          template_name: template.name,
          message_id: promptId,
          status: 'sent',
          content_payload: { smart_retry_prompt_id: id },
        });
    }
  } catch (error) {
    if (promptAccepted)
      console.error('[smart-retry] prompt bookkeeping failed:', error);
    else
      await update(db, id, {
        status: 'failed',
        error_message:
          error instanceof Error ? error.message : 'Recovery prompt failed',
      });
  }
}

export async function handleRecoveryStatus(
  db: SupabaseClient,
  phoneNumberId: string,
  status: { id: string; status: string; errors?: { code?: number }[] }
) {
  const { data: config } = await db
    .from('whatsapp_config')
    .select('id')
    .eq('phone_number_id', phoneNumberId)
    .maybeSingle();
  if (!config) return;
  const { data: original } = await db
    .from('smart_retry_messages')
    .select('id')
    .eq('whatsapp_config_id', config.id)
    .eq('original_message_id', status.id)
    .maybeSingle();
  if (original) {
    if (
      status.status === 'failed' &&
      status.errors?.some((e) => e.code === 131049)
    )
      await promptRecovery(db, original.id);
    if (['delivered', 'read'].includes(status.status)) {
      await db
        .from('smart_retry_messages')
        .update({ status: 'cancelled' })
        .eq('id', original.id)
        .in('status', ['tracking', 'prompting', 'awaiting_acceptance']);
    }
  }
  if (['failed', 'delivered', 'read'].includes(status.status)) {
    await db
      .from('smart_retry_messages')
      .update({
        status: status.status === 'failed' ? 'failed' : 'delivered',
        ...(status.status === 'failed'
          ? {
              error_message: `Recovery resend delivery failed${status.errors?.length ? ` (${status.errors.map((e) => e.code ?? 'unknown').join(', ')})` : ''}`,
            }
          : {}),
      })
      .eq('whatsapp_config_id', config.id)
      .eq('retry_message_id', status.id)
      .in('status', ['resent', 'retrying']);
    if (status.status === 'failed')
      await db
        .from('smart_retry_messages')
        .update({
          status: 'failed',
          error_message: 'Recovery prompt delivery failed',
        })
        .eq('whatsapp_config_id', config.id)
        .eq('prompt_message_id', status.id)
        .eq('status', 'awaiting_acceptance');
  }
}

/** Returns true for ALL recovery tokens, including stale/forged ones: never
 * dispatch them to flows, keyword automations or the AI responder. */
export async function acceptRecovery(
  db: SupabaseClient,
  accountId: string,
  configId: string,
  recipient: string,
  token: string,
  contextId?: string,
  conversationId?: string
): Promise<boolean> {
  if (!isRecoveryPayload(token)) return false;
  const id = token.slice(RECOVERY_PREFIX.length);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  )
    return true;
  const { data: row, error } = await db
    .from('smart_retry_messages')
    .update({ status: 'retrying' })
    .eq('id', id)
    .eq('account_id', accountId)
    .eq('whatsapp_config_id', configId)
    .eq('recipient', canonicalContactPhone(recipient))
    .eq('prompt_message_id', contextId ?? '')
    .eq('status', 'awaiting_acceptance')
    .gt('expires_at', new Date().toISOString())
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!row) return true;
  let retryAccepted = false;
  try {
    const { data: settings } = await db
      .from('smart_retry_settings')
      .select('enabled')
      .eq('whatsapp_config_id', configId)
      .maybeSingle();
    const { data: config } = await db
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', configId)
      .maybeSingle();
    if (!settings?.enabled || !config || config.status === 'disconnected')
      throw new Error('Smart Retry disabled or number disconnected');
    const payload = row.payload as Record<string, unknown>;
    const saved = payload.template as {
      name: string;
      language: { code: string };
    };
    const { data: template } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('whatsapp_config_id', configId)
      .eq('name', saved.name)
      .eq('language', saved.language.code)
      .maybeSingle();
    if (template?.status !== 'APPROVED' || template.category !== 'Marketing')
      throw new Error('Original marketing template is no longer approved');
    // A later manual retry might already have delivered the original.
    const { data: delivered } = await db
      .from('messages')
      .select('id, conversations!inner(account_id, whatsapp_config_id)')
      .eq('conversations.account_id', accountId)
      .eq('conversations.whatsapp_config_id', configId)
      .eq('message_id', row.original_message_id ?? '')
      .in('status', ['delivered', 'read'])
      .limit(1);
    if (delivered?.length) {
      await update(db, id, { status: 'cancelled' });
      return true;
    }
    await assertWalletCanSend(accountId, template.category);
    const retryId = await sendPayload(config, payload);
    retryAccepted = true;
    await update(db, id, { status: 'resent', retry_message_id: retryId });
    await debitWalletForTemplateSend({
      accountId,
      templateCategory: template.category,
      messageId: retryId,
      templateName: saved.name,
    });
    // Preserve the original failure; add the resend as a new inbox bubble.
    const { data: original } = await db
      .from('messages')
      .select(
        'conversation_id, content_text, template_name, media_url, conversations!inner(account_id, whatsapp_config_id)'
      )
      .eq('conversations.account_id', accountId)
      .eq('conversations.whatsapp_config_id', configId)
      .eq('message_id', row.original_message_id ?? '')
      .limit(1)
      .maybeSingle();
    const targetConversation = original?.conversation_id ?? conversationId;
    if (targetConversation) {
      const components = (
        saved as {
          components?: { type: string; parameters?: { text?: string }[] }[];
        }
      ).components;
      const body = components?.find((c) => c.type === 'body')?.parameters ?? [];
      const text =
        original?.content_text ??
        String(template.body_text).replace(
          /\{\{(\d+)\}\}/g,
          (match, position) => body[Number(position) - 1]?.text ?? match
        );
      await persistOutboundAfterMetaSend(
        db,
        {
          conversation_id: targetConversation,
          content_text: text,
          template_name: saved.name,
          media_url: original?.media_url ?? null,
          sender_type: 'agent',
          content_type: 'template',
          message_id: retryId,
          status: 'sent',
          content_payload: { smart_retry_id: id },
        },
        { conversationId: targetConversation, lastMessageText: text }
      );
    }
    // Keep campaign counters and future delivery webhooks linked to the resend.
    if (row.original_message_id) {
      const { data: broadcasts } = await db
        .from('broadcasts')
        .select('id')
        .eq('account_id', accountId);
      if (broadcasts?.length) {
        const { data: recoveredRecipients, error: recipientError } = await db
          .from('broadcast_recipients')
          .update({
            whatsapp_message_id: retryId,
            status: 'sent',
            error_message: null,
          })
          .in(
            'broadcast_id',
            broadcasts.map((b) => b.id)
          )
          .eq('whatsapp_message_id', row.original_message_id)
          .eq('status', 'failed')
          .select('broadcast_id');
        if (recipientError) throw recipientError;
        if (recoveredRecipients?.length) {
          const { finalizeBroadcastStatus } = await import('./broadcast-core');
          for (const broadcastId of new Set(
            recoveredRecipients.map((r) => r.broadcast_id as string)
          ))
            await finalizeBroadcastStatus(db, broadcastId);
        }
      }
    }
  } catch (error) {
    if (retryAccepted)
      console.error('[smart-retry] resend bookkeeping failed:', error);
    else
      await update(db, id, {
        status: 'failed',
        error_message:
          error instanceof Error ? error.message : 'Recovery resend failed',
      });
  }
  return true;
}
