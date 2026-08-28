import { sendTextMessage, sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  assertWalletCanSend,
  debitWalletForTemplateSend,
} from '@/lib/wallet/billing'
import { persistOutboundAfterMetaSend } from '@/lib/whatsapp/persist-outbound-message'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
  contactPhoneAfterSuccessfulSend,
} from '@/lib/whatsapp/phone-utils'
import type { MessageTemplate } from '@/types'
import {
  buildTemplateMessageSnapshot,
  templateDisplayPayload,
} from '@/lib/inbox/template-message-display'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side Meta sender.
//
// Mirrors the logic in src/app/api/whatsapp/send/route.ts but uses
// the service-role client (engine has no cookies) and accepts the
// user / conversation / contact identifiers the engine already has
// on hand. Kept here (rather than refactoring the user-facing send
// route) to avoid risk to the working manual-send path — they can
// converge in a later refactor.
// ------------------------------------------------------------

interface SendTextArgs {
  /** Account-level tenancy key. Drives contact + whatsapp_config
   *  lookups so an automation authored by user A still sends through
   *  the WhatsApp number user B saved on the same account. */
  accountId: string
  /** Original author of the automation/flow — used for INSERT audit
   *  columns (messages.sender_id-ish) and for resolving the agent's
   *  identity in logs. Not consulted for tenancy. */
  userId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  accountId: string
  userId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  /** Legacy body-only positional values. */
  params?: string[]
  /** Structured header / body / button values for Meta send. */
  messageParams?: SendTimeParams
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'text' })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return sendViaMeta({ ...args, kind: 'template' })
}

type SendInput =
  | (SendTextArgs & { kind: 'text' })
  | (SendTemplateArgs & { kind: 'template' })

async function sendViaMeta(input: SendInput): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact + config lookups by account_id, not user_id.
  // The engine uses the service-role client (bypassing RLS); without
  // this filter, an authenticated user could fire their own
  // automations against another tenant's contact UUID and send via
  // their own WhatsApp config to that contact's phone. The 017
  // migration moved both tables to account-scoped tenancy, so the
  // check is the same defense-in-depth as before, just keyed on the
  // new tenancy column.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id, phone')
    .eq('id', input.contactId)
    .eq('account_id', input.accountId)
    .maybeSingle()
  if (contactErr || !contact?.phone) {
    throw new Error('contact not found for this account')
  }

  const sanitized = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitized)) {
    throw new Error(`contact phone invalid: ${contact.phone}`)
  }

  const { data: config, error: configErr } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', input.accountId)
    .single()
  if (configErr || !config) {
    throw new Error('WhatsApp not configured for this account')
  }

  const accessToken = decrypt(config.access_token)

  let templateCategory: string | null = null
  let templateRow: MessageTemplate | null = null
  if (input.kind === 'template') {
    const lang = input.language ?? 'en_US'
    const { data: row } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', input.accountId)
      .eq('name', input.templateName)
      .eq('language', lang)
      .maybeSingle()
    if (row && isMessageTemplate(row)) {
      templateRow = row
      templateCategory = row.category
    } else if (row?.category) {
      templateCategory = row.category as string
    }
    await assertWalletCanSend(input.accountId, templateCategory)
  }

  const attempt = async (phone: string): Promise<string> => {
    if (input.kind === 'template') {
      const r = await sendTemplateMessage({
        phoneNumberId: config.phone_number_id,
        accessToken,
        to: phone,
        templateName: input.templateName,
        language: input.language,
        template: templateRow ?? undefined,
        messageParams: input.messageParams,
        params: input.params,
      })
      return r.messageId
    }
    const r = await sendTextMessage({
      phoneNumberId: config.phone_number_id,
      accessToken,
      to: phone,
      text: input.text,
    })
    return r.messageId
  }

  // Same phone-variant retry as /api/whatsapp/send — Meta sandbox and
  // numbers registered with/without a trunk 0 both require this to
  // reliably land a message.
  const variants = phoneVariants(sanitized)
  let workingPhone = sanitized
  let waMessageId = ''
  let lastError: unknown = null
  for (const v of variants) {
    try {
      waMessageId = await attempt(v)
      workingPhone = v
      lastError = null
      break
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isRecipientNotAllowedError(msg)) throw err
      lastError = err
    }
  }
  if (lastError) throw lastError

  if (workingPhone !== sanitized) {
    const storedPhone = contactPhoneAfterSuccessfulSend(sanitized, workingPhone)
    await db.from('contacts').update({ phone: storedPhone }).eq('id', contact.id)
  }

  // Persist the sent message so it appears in the inbox with a real
  // Meta message id. sender_type='bot' distinguishes automation sends
  // from manual agent sends.
  const content_type = input.kind === 'template' ? 'template' : 'text'
  const template_name = input.kind === 'template' ? input.templateName : null
  // For templates, render the approved body with send-time params so the
  // inbox shows the same preview agents see for manual template sends
  // (not just "Template · name" with an empty bubble).
  let content_text: string | null = null
  let content_payload: Record<string, unknown> | null = null
  if (input.kind === 'text') {
    content_text = input.text
  } else if (input.kind === 'template') {
    const bodyParams =
      input.messageParams?.body ?? input.params ?? []
    const body = templateRow?.body_text?.trim()
    if (body) {
      content_text = body.replace(/\{\{(\d+)\}\}/g, (_, raw: string) => {
        const idx = Number(raw) - 1
        return bodyParams[idx] ?? `{{${raw}}}`
      })
    }
    if (templateRow) {
      content_payload = templateDisplayPayload(
        buildTemplateMessageSnapshot(templateRow, {
          headerMediaUrl: input.messageParams?.headerMediaUrl,
          headerText: input.messageParams?.headerText,
          buttonParams: input.messageParams?.buttonParams,
        }),
      )
    }
  }

  const previewText =
    content_text ??
    (input.kind === 'template'
      ? `[template:${input.templateName}]`
      : input.text)

  await persistOutboundAfterMetaSend(
    db,
    {
      conversation_id: input.conversationId,
      sender_type: 'bot',
      sender_id: input.userId,
      content_type,
      content_text,
      template_name,
      content_payload,
      message_id: waMessageId,
      status: 'sent',
    },
    {
      conversationId: input.conversationId,
      lastMessageText: previewText,
    },
  )

  if (input.kind === 'template') {
    await debitWalletForTemplateSend({
      accountId: input.accountId,
      templateCategory,
      messageId: waMessageId,
      templateName: input.templateName,
    })
  }

  return { whatsapp_message_id: waMessageId }
}
