/**
 * Submit a WhatsApp message template to Meta for one account and
 * persist the local `message_templates` row.
 *
 * Used by the brand-scoped submit route and by the super-admin
 * multi-brand push. Callers pass any Supabase client that can write
 * `whatsapp_config` / `message_templates` for `accountId` (user SSR
 * with acting context, or the service-role admin client).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt } from '@/lib/whatsapp/encryption'
import { submitMessageTemplate } from '@/lib/whatsapp/meta-api'
import { buildMetaTemplatePayload } from '@/lib/whatsapp/template-components'
import { ensureImageHeaderHandle } from '@/lib/whatsapp/template-header-handle'
import { normalizeStatus } from '@/lib/whatsapp/template-status-normalize'
import type { TemplatePayload } from '@/lib/whatsapp/template-validators'

export type SubmitTemplateForAccountResult =
  | {
      ok: true
      dryRun: boolean
      status: string
      metaTemplateId: string
      templateId: string | null
    }
  | {
      ok: false
      status: number
      error: string
      metaTemplateId?: string
    }

function clonePayload(payload: TemplatePayload): TemplatePayload {
  return {
    ...payload,
    buttons: payload.buttons ? structuredClone(payload.buttons) : undefined,
    sample_values: payload.sample_values
      ? structuredClone(payload.sample_values)
      : undefined,
    // Re-derive header handles per WABA access token.
    header_handle: undefined,
  }
}

function buildRow(
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: string
    metaTemplateId: string | null
    submissionError: string | null
  },
) {
  return {
    account_id: accountId,
    user_id: userId,
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_type: payload.header_type ?? null,
    header_content: payload.header_content ?? null,
    header_media_url: payload.header_media_url ?? null,
    header_handle: payload.header_handle ?? null,
    body_text: payload.body_text,
    footer_text: payload.footer_text ?? null,
    buttons: payload.buttons ?? null,
    sample_values: payload.sample_values ?? null,
    status: extras.status,
    meta_template_id: extras.metaTemplateId,
    submission_error: extras.submissionError,
    rejection_reason: null,
    last_submitted_at: new Date().toISOString(),
  }
}

async function persistTemplateRow(
  supabase: SupabaseClient,
  accountId: string,
  userId: string,
  payload: TemplatePayload,
  extras: {
    status: string
    metaTemplateId: string | null
    submissionError: string | null
  },
): Promise<{ id: string | null; error: string | null }> {
  const row = buildRow(accountId, userId, payload, extras)

  const { data: existing, error: lookupErr } = await supabase
    .from('message_templates')
    .select('id')
    .eq('account_id', accountId)
    .eq('name', payload.name)
    .eq('language', payload.language)
    .maybeSingle()

  if (lookupErr) {
    return { id: null, error: lookupErr.message }
  }

  if (existing?.id) {
    const { data, error } = await supabase
      .from('message_templates')
      .update(row)
      .eq('id', existing.id)
      .select('id')
      .single()
    return { id: data?.id ?? existing.id, error: error?.message ?? null }
  }

  const { data, error } = await supabase
    .from('message_templates')
    .insert(row)
    .select('id')
    .single()
  return { id: data?.id ?? null, error: error?.message ?? null }
}

export async function submitTemplateForAccount(args: {
  supabase: SupabaseClient
  accountId: string
  /** Audit author on the local row (brand owner preferred). */
  userId: string
  payload: TemplatePayload
}): Promise<SubmitTemplateForAccountResult> {
  const { supabase, accountId, userId } = args
  const payload = clonePayload(args.payload)

  const dryRun =
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === 'true' ||
    process.env.WHATSAPP_TEMPLATES_DRY_RUN === '1'

  let metaTemplateId: string
  let metaStatus: string

  if (dryRun) {
    metaTemplateId = `dry-run-${crypto.randomUUID()}`
    metaStatus = 'PENDING'
  } else {
    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('waba_id, access_token')
      .eq('account_id', accountId)
      .maybeSingle()

    if (configError || !config) {
      return {
        ok: false,
        status: 400,
        error:
          'WhatsApp not configured. Connect WhatsApp for this brand first.',
      }
    }
    if (!config.waba_id) {
      return {
        ok: false,
        status: 400,
        error: 'WABA ID missing. Re-connect WhatsApp for this brand.',
      }
    }
    if (!config.access_token) {
      return {
        ok: false,
        status: 400,
        error: 'WhatsApp access token missing for this brand.',
      }
    }

    let accessToken: string
    try {
      accessToken = decrypt(config.access_token)
    } catch {
      return {
        ok: false,
        status: 400,
        error:
          'Stored access token cannot be decrypted. Reset WhatsApp config for this brand.',
      }
    }

    try {
      await ensureImageHeaderHandle(payload, accessToken)
    } catch (e) {
      return {
        ok: false,
        status: 400,
        error: e instanceof Error ? e.message : 'Header image upload failed.',
      }
    }

    const metaPayload = buildMetaTemplatePayload(payload)
    try {
      const meta = await submitMessageTemplate({
        wabaId: config.waba_id,
        accessToken,
        payload: metaPayload,
      })
      metaTemplateId = meta.id
      metaStatus = meta.status
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Meta submit failed.'
      await persistTemplateRow(supabase, accountId, userId, payload, {
        status: 'DRAFT',
        metaTemplateId: null,
        submissionError: message,
      })
      const isRateLimit = /\b429\b/.test(message)
      return {
        ok: false,
        status: isRateLimit ? 429 : 502,
        error: isRateLimit
          ? 'Meta rate limit hit (100 template creates per hour). Try again later.'
          : message,
      }
    }
  }

  const persisted = await persistTemplateRow(supabase, accountId, userId, payload, {
    status: normalizeStatus(metaStatus),
    metaTemplateId,
    submissionError: null,
  })

  if (persisted.error) {
    return {
      ok: false,
      status: 500,
      error: `Submitted to Meta but failed to save locally: ${persisted.error}. Run "Sync from Meta" in the brand to recover.`,
      metaTemplateId,
    }
  }

  return {
    ok: true,
    dryRun,
    status: normalizeStatus(metaStatus),
    metaTemplateId,
    templateId: persisted.id,
  }
}
