import type { SupabaseClient } from '@supabase/supabase-js';

import {
  badRequest,
  insufficientBalance,
  notFound,
  providerError,
} from '@/lib/api/v1/respond';
import { resolveSendTimeParams } from '@/lib/api/v1/template-params';
import {
  buildTemplateMessageSnapshot,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display';
import {
  ensureConversation,
  ensureShopifyContact,
} from '@/lib/shopify/ensure-contact';
import {
  assertWalletCanSend,
  debitWalletForTemplateSend,
  InsufficientWalletBalanceError,
} from '@/lib/wallet/billing';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  contactPhoneAfterSuccessfulSend,
  isRecipientNotAllowedError,
  isValidE164,
  phoneVariants,
  sanitizePhoneForMeta,
} from '@/lib/whatsapp/phone-utils';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import type { MessageTemplate } from '@/types';

export interface ExternalSendMetadata {
  company_id?: string;
  journey?: string;
  stage?: string;
  [key: string]: string | undefined;
}

export interface ExternalSendInput {
  accountId: string;
  /** Key creator when known; resolved from account config otherwise. */
  ownerUserId: string | null;
  templateId: string;
  phone: string;
  params?: string[] | Record<string, string>;
  metadata?: ExternalSendMetadata;
}

export interface ExternalSendResult {
  status: 'sent';
  message_id: string;
  whatsapp_message_id: string;
  conversation_id: string;
}

async function loadApprovedTemplate(
  db: SupabaseClient,
  accountId: string,
  templateId: string,
): Promise<MessageTemplate> {
  const byName = await db
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', templateId)
    .eq('status', 'APPROVED')
    .maybeSingle();

  let row = byName.data;
  if (!row) {
    const byUuid = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('id', templateId)
      .eq('status', 'APPROVED')
      .maybeSingle();
    row = byUuid.data;
  }

  if (!row) {
    throw notFound(`Template "${templateId}" was not found or is not approved`);
  }
  if (!isMessageTemplate(row)) {
    throw badRequest(
      'Template row is malformed locally — sync templates from Meta in Settings',
    );
  }
  return row;
}

async function resolveOwnerUserId(
  db: SupabaseClient,
  accountId: string,
  fallbackUserId: string | null,
): Promise<string> {
  if (fallbackUserId) return fallbackUserId;

  const { data: config } = await db
    .from('whatsapp_config')
    .select('user_id')
    .eq('account_id', accountId)
    .maybeSingle();
  if (config?.user_id) return config.user_id as string;

  const { data: profile } = await db
    .from('profiles')
    .select('user_id')
    .eq('account_id', accountId)
    .limit(1)
    .maybeSingle();
  if (profile?.user_id) return profile.user_id as string;

  throw badRequest('Could not resolve an account owner for outbound messaging');
}

export async function sendExternalTemplateMessage(
  db: SupabaseClient,
  input: ExternalSendInput,
): Promise<ExternalSendResult> {
  const template = await loadApprovedTemplate(db, input.accountId, input.templateId);
  const ownerUserId = await resolveOwnerUserId(
    db,
    input.accountId,
    input.ownerUserId,
  );

  const sanitizedPhone = sanitizePhoneForMeta(input.phone);
  if (!isValidE164(sanitizedPhone)) {
    throw badRequest('phone must be a valid E.164 number (e.g. +919876543210)');
  }

  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single();
  if (configError || !config) {
    throw badRequest('WhatsApp is not configured for this brand');
  }

  const messageParams = resolveSendTimeParams(
    template,
    input.params ?? (template.sample_values?.body ?? []),
  );

  try {
    await assertWalletCanSend(input.accountId, template.category);
  } catch (err) {
    if (err instanceof InsufficientWalletBalanceError) {
      throw insufficientBalance(err.message);
    }
    throw err;
  }

  const accessToken = decrypt(config.access_token);
  const variants = phoneVariants(sanitizedPhone);
  let workingPhone = sanitizedPhone;
  let whatsappMessageId = '';
  let lastError: unknown = null;

  for (const variant of variants) {
    try {
      const result = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: variant,
        templateName: template.name,
        language: template.language ?? 'en_US',
        template,
        messageParams,
      });
      whatsappMessageId = result.messageId;
      workingPhone = variant;
      lastError = null;
      break;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!isRecipientNotAllowedError(message)) {
        throw providerError(message);
      }
      lastError = err;
    }
  }

  if (lastError) {
    const message =
      lastError instanceof Error ? lastError.message : 'Meta rejected the recipient';
    throw providerError(message);
  }

  const contactName =
    typeof input.params === 'object' && !Array.isArray(input.params)
      ? input.params.customer_name
      : undefined;

  const contact = await ensureShopifyContact(
    db,
    input.accountId,
    ownerUserId,
    workingPhone,
    contactName ?? workingPhone,
  );
  if (!contact) {
    throw badRequest('Could not create or resolve a contact for this phone number');
  }

  if (workingPhone !== sanitizedPhone) {
    const storedPhone = contactPhoneAfterSuccessfulSend(
      sanitizedPhone,
      workingPhone,
    );
    await db.from('contacts').update({ phone: storedPhone }).eq('id', contact.id);
  }

  const conversation = await ensureConversation(
    db,
    input.accountId,
    ownerUserId,
    contact.id,
    { createStatus: 'closed' },
  );
  if (!conversation) {
    throw badRequest('Could not create or resolve a conversation for this contact');
  }

  const bodyParams = messageParams.body ?? [];
  const renderedBody = template.body_text.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
    const index = Number(raw) - 1;
    return bodyParams[index] ?? `{{${raw}}}`;
  });

  const contentPayload = {
    ...templateDisplayPayload(
      buildTemplateMessageSnapshot(template, {
        headerMediaUrl: messageParams.headerMediaUrl,
        headerText: messageParams.headerText,
      }),
    ),
    external_metadata: input.metadata ?? null,
  };

  const { data: messageRecord, error: insertError } = await db
    .from('messages')
    .insert({
      conversation_id: conversation.id,
      sender_type: 'bot',
      sender_id: ownerUserId,
      content_type: 'template',
      content_text: renderedBody,
      template_name: template.name,
      content_payload: contentPayload,
      message_id: whatsappMessageId,
      status: 'sent',
    })
    .select('id')
    .single();

  if (insertError || !messageRecord) {
    console.error('[api/v1/send] message insert failed:', insertError?.message);
    throw providerError(
      'Message was accepted by Meta but failed to persist locally — retry may duplicate delivery',
    );
  }

  await debitWalletForTemplateSend({
    accountId: input.accountId,
    templateCategory: template.category,
    messageId: messageRecord.id,
    templateName: template.name,
  });

  await db
    .from('conversations')
    .update({
      last_message_text: renderedBody,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversation.id);

  return {
    status: 'sent',
    message_id: whatsappMessageId,
    whatsapp_message_id: whatsappMessageId,
    conversation_id: conversation.id,
  };
}
