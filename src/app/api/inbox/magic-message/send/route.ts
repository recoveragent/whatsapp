import { NextResponse } from 'next/server';

import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account';
import { canSendMessages } from '@/lib/auth/roles';
import {
  buildTemplateMessageSnapshot,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display';
import {
  getMagicMessageSettings,
  loadMagicMessageTemplate,
} from '@/lib/inbox/magic-message-settings';
import { renderMagicMessagePng } from '@/lib/inbox/magic-message-render';
import { isServiceWindowOpen } from '@/lib/inbox/service-window';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  assertWalletCanSend,
  debitWalletForTemplateSend,
  InsufficientWalletBalanceError,
} from '@/lib/wallet/billing';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  contactPhoneAfterSuccessfulSend,
} from '@/lib/whatsapp/phone-utils';
import { decrypt } from '@/lib/whatsapp/encryption';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    if (!canSendMessages(ctx.role)) {
      throw new ForbiddenError('Your role cannot send messages');
    }

    const limit = checkRateLimit(`send:${ctx.userId}`, RATE_LIMITS.send);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const body = (await request.json()) as {
      conversation_id?: string;
      content_text?: string;
      reply_to_message_id?: string;
    };

    const conversationId = body.conversation_id?.trim();
    const contentText = body.content_text?.trim();

    if (!conversationId || !contentText) {
      return NextResponse.json(
        { error: 'conversation_id and content_text are required' },
        { status: 400 },
      );
    }

    const { data: conversation, error: convError } = await ctx.supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conversationId)
      .eq('account_id', ctx.accountId)
      .single();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const assigneeId = (conversation.assigned_agent_id as string | null) ?? null;
    if (!assigneeId || assigneeId !== ctx.userId) {
      return NextResponse.json(
        {
          error: assigneeId
            ? 'This chat is assigned to someone else — reassign it to yourself before replying'
            : 'Self-assign this chat before replying',
        },
        { status: 403 },
      );
    }

    const lastCustomerAt = conversation.last_customer_message_at as
      | string
      | null
      | undefined;

    if (!lastCustomerAt) {
      return NextResponse.json(
        {
          error:
            'Magic Message requires a prior customer reply — use a template to start the conversation.',
          code: 'MAGIC_MESSAGE_NO_CUSTOMER_HISTORY',
        },
        { status: 422 },
      );
    }

    if (isServiceWindowOpen(lastCustomerAt)) {
      return NextResponse.json(
        {
          error:
            'The messaging window is still open — send a normal message instead.',
          code: 'SERVICE_WINDOW_OPEN',
        },
        { status: 422 },
      );
    }

    const settings = await getMagicMessageSettings(ctx.supabase, ctx.accountId);
    if (!settings.enabled) {
      return NextResponse.json(
        { error: 'Magic Message is disabled for this brand.' },
        { status: 403 },
      );
    }

    const templateRow = await loadMagicMessageTemplate(ctx.supabase, ctx.accountId, {
      template_name: settings.template_name,
      template_language: settings.template_language,
    });

    const contact = conversation.contact as { id: string; phone?: string } | null;
    if (!contact?.phone) {
      return NextResponse.json(
        { error: 'Contact phone number not found' },
        { status: 400 },
      );
    }

    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitizedPhone)) {
      return NextResponse.json(
        { error: 'Invalid phone number format' },
        { status: 400 },
      );
    }

    const { data: config, error: configError } = await ctx.supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .single();

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 },
      );
    }

    let contextMessageId: string | undefined;
    if (body.reply_to_message_id) {
      const { data: parent } = await ctx.supabase
        .from('messages')
        .select('message_id, conversation_id')
        .eq('id', body.reply_to_message_id)
        .eq('conversation_id', conversationId)
        .maybeSingle();

      if (parent?.message_id) {
        contextMessageId = parent.message_id;
      }
    }

    try {
      await assertWalletCanSend(ctx.accountId, templateRow.category);
    } catch (err) {
      if (err instanceof InsufficientWalletBalanceError) {
        return NextResponse.json(
          { error: err.message, code: 'insufficient_balance' },
          { status: 402 },
        );
      }
      throw err;
    }

    const pngBuffer = await renderMagicMessagePng(contentText);
    const path = buildMediaPath(ctx.accountId, 'magic-message.png');
    const admin = supabaseAdmin();

    const { error: uploadError } = await admin.storage
      .from('chat-media')
      .upload(path, pngBuffer, {
        cacheControl: '3600',
        upsert: false,
        contentType: 'image/png',
      });

    if (uploadError) {
      return NextResponse.json(
        { error: `Failed to upload rendered message: ${uploadError.message}` },
        { status: 500 },
      );
    }

    const {
      data: { publicUrl },
    } = admin.storage.from('chat-media').getPublicUrl(path);

    const accessToken = decrypt(config.access_token);
    const messageParams = {
      headerMediaUrl: publicUrl,
      headerMediaRequired: true,
    };

    let waMessageId = '';
    let workingPhone = sanitizedPhone;

    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: templateRow.name,
            language: templateRow.language,
            template: templateRow,
            messageParams,
            contextMessageId,
          });
          waMessageId = result.messageId;
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) throw err;
          lastError = err;
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      await admin.storage.from('chat-media').remove([path]).catch(() => {});
      const message = err instanceof Error ? err.message : 'Unknown Meta API error';
      return NextResponse.json(
        { error: `Meta API error: ${message}` },
        { status: 502 },
      );
    }

    if (workingPhone !== sanitizedPhone) {
      await ctx.supabase
        .from('contacts')
        .update({
          phone: contactPhoneAfterSuccessfulSend(sanitizedPhone, workingPhone),
        })
        .eq('id', contact.id);
    }

    const templateContentPayload = templateDisplayPayload(
      buildTemplateMessageSnapshot(templateRow, {
        headerMediaUrl: publicUrl,
      }),
    );

    const { data: messageRecord, error: msgError } = await ctx.supabase
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: ctx.userId,
        content_type: 'template',
        content_text: contentText,
        template_name: templateRow.name,
        content_payload: templateContentPayload,
        message_id: waMessageId,
        status: 'sent',
        reply_to_message_id: body.reply_to_message_id || null,
      })
      .select()
      .single();

    if (msgError) {
      return NextResponse.json(
        {
          error: `Message sent to Meta but failed to save to DB: ${msgError.message}`,
        },
        { status: 500 },
      );
    }

    await debitWalletForTemplateSend({
      accountId: ctx.accountId,
      templateCategory: templateRow.category,
      messageId: messageRecord.id,
      templateName: templateRow.name,
    });

    await ctx.supabase
      .from('conversations')
      .update({
        last_message_text: contentText,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', conversationId);

    try {
      await admin
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('account_id', ctx.accountId)
        .eq('contact_id', contact.id)
        .eq('status', 'active');
    } catch (err) {
      console.error(
        '[magic-message] pause-on-agent-send failed:',
        err instanceof Error ? err.message : err,
      );
    }

    return NextResponse.json({
      success: true,
      message_id: messageRecord.id,
      whatsapp_message_id: waMessageId,
    });
  } catch (error) {
    console.error('Error in magic-message send POST:', error);
    return toErrorResponse(error);
  }
}
