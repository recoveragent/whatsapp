import type { SupabaseClient } from '@supabase/supabase-js'

import { sendTextMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import type { InboxFollowupSettings } from '@/types'

export const DEFAULT_FOLLOWUP_DELAY_HOURS = 4
export const DEFAULT_FOLLOWUP_MESSAGE =
  'Hi, We are waiting for your response'

export function followupScheduledAt(delayHours: number, from = new Date()): string {
  return new Date(from.getTime() + delayHours * 60 * 60 * 1000).toISOString()
}

export async function getFollowupSettings(
  supabase: SupabaseClient,
  accountId: string,
): Promise<InboxFollowupSettings> {
  const { data } = await supabase
    .from('inbox_followup_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle()

  if (data) return data as InboxFollowupSettings

  return {
    account_id: accountId,
    delay_hours: DEFAULT_FOLLOWUP_DELAY_HOURS,
    message_text: DEFAULT_FOLLOWUP_MESSAGE,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

export async function upsertFollowupSettings(
  supabase: SupabaseClient,
  accountId: string,
  patch: { delay_hours?: number; message_text?: string },
): Promise<InboxFollowupSettings> {
  const existing = await getFollowupSettings(supabase, accountId)
  const delay_hours = patch.delay_hours ?? existing.delay_hours
  const message_text = (patch.message_text ?? existing.message_text).trim()

  const { data, error } = await supabase
    .from('inbox_followup_settings')
    .upsert(
      {
        account_id: accountId,
        delay_hours,
        message_text,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    .select('*')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save follow-up settings')
  }

  return data as InboxFollowupSettings
}

type ConversationRow = {
  id: string
  account_id: string
  user_id: string
  contact_id: string
  status: string
  followup_scheduled_at: string | null
  followup_sent_at: string | null
  contact: { id: string; phone: string } | { id: string; phone: string }[] | null
}

function resolveContact(
  contact: ConversationRow['contact'],
): { id: string; phone: string } | null {
  if (!contact) return null
  return Array.isArray(contact) ? contact[0] ?? null : contact
}

export async function sendScheduledFollowup(
  admin: SupabaseClient,
  conversation: ConversationRow,
  messageText: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const contact = resolveContact(conversation.contact)
  if (!contact?.phone) {
    return { ok: false, error: 'Contact phone not found' }
  }

  const sanitizedPhone = sanitizePhoneForMeta(contact.phone)
  if (!isValidE164(sanitizedPhone)) {
    return { ok: false, error: 'Invalid contact phone' }
  }

  const { data: config, error: configError } = await admin
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', conversation.account_id)
    .maybeSingle()

  if (configError || !config) {
    return { ok: false, error: 'WhatsApp not configured' }
  }

  const accessToken = decrypt(config.access_token)
  const text = messageText.trim()
  if (!text) {
    return { ok: false, error: 'Follow-up message is empty' }
  }

  let waMessageId = ''
  let workingPhone = sanitizedPhone

  try {
    const variants = phoneVariants(sanitizedPhone)
    let lastError: unknown = null

    for (const variant of variants) {
      try {
        const result = await sendTextMessage({
          phoneNumberId: config.phone_number_id,
          accessToken,
          to: variant,
          text,
        })
        waMessageId = result.messageId
        workingPhone = variant
        lastError = null
        break
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(message)) throw err
        lastError = err
      }
    }

    if (lastError) throw lastError
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Meta API error'
    return { ok: false, error: message }
  }

  if (workingPhone !== sanitizedPhone) {
    await admin
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id)
  }

  const now = new Date().toISOString()
  const { error: msgError } = await admin.from('messages').insert({
    conversation_id: conversation.id,
    sender_type: 'bot',
    content_type: 'text',
    content_text: text,
    message_id: waMessageId,
    status: 'sent',
  })

  if (msgError) {
    return { ok: false, error: `Sent to Meta but DB insert failed: ${msgError.message}` }
  }

  await admin
    .from('conversations')
    .update({
      last_message_text: text,
      last_message_at: now,
      followup_sent_at: now,
      updated_at: now,
    })
    .eq('id', conversation.id)

  return { ok: true }
}

export async function processDueFollowups(
  admin: SupabaseClient,
  limit = 50,
): Promise<{ processed: number; failed: number }> {
  const now = new Date().toISOString()
  const { data: due, error } = await admin
    .from('conversations')
    .select(
      'id, account_id, user_id, contact_id, status, followup_scheduled_at, followup_sent_at, contact:contacts(id, phone)',
    )
    .eq('status', 'followup')
    .is('followup_sent_at', null)
    .lte('followup_scheduled_at', now)
    .order('followup_scheduled_at', { ascending: true })
    .limit(limit)

  if (error) throw new Error(error.message)
  if (!due?.length) return { processed: 0, failed: 0 }

  let processed = 0
  let failed = 0

  for (const row of due as ConversationRow[]) {
    const settings = await getFollowupSettings(admin, row.account_id)
    const result = await sendScheduledFollowup(admin, row, settings.message_text)
    if (result.ok) {
      processed++
    } else {
      failed++
      console.error(
        `[inbox-followup-cron] conversation ${row.id} failed:`,
        result.error,
      )
    }
  }

  return { processed, failed }
}
