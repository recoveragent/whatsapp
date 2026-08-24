/**
 * Backfill WhatsApp Flow form submissions stored as "[Interactive reply]".
 *
 * wacrm did not persist nfm_reply payloads before the whatsapp_flow
 * handler shipped. This script repairs rows when you have Meta webhook
 * bodies (JSON array or JSONL export from your server / Meta debugger).
 *
 * Usage:
 *   # See how many inbox rows look like missed form submissions
 *   node scripts/backfill-whatsapp-form-submissions.mjs --scan
 *
 *   # Preview updates from a webhook export (no writes)
 *   node scripts/backfill-whatsapp-form-submissions.mjs --file ./webhooks.jsonl --dry-run
 *
 *   # Apply updates
 *   node scripts/backfill-whatsapp-form-submissions.mjs --file ./webhooks.jsonl
 *
 * Env (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * File formats:
 *   - JSON array of full Meta webhook bodies
 *   - JSONL: one webhook body per line
 *   - Single webhook object
 */

import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error(
    'Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local',
  )
  process.exit(1)
}

const db = createClient(url, serviceKey)

const INTERNAL_RESPONSE_KEYS = new Set([
  'flow_token',
  'screen',
  'extension_message_response',
  'saved_address_id',
])

function asStringRecord(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {}
  const out = {}
  for (const [k, v] of Object.entries(input)) {
    if (INTERNAL_RESPONSE_KEYS.has(k)) continue
    if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v)
    else if (typeof v === 'boolean') out[k] = v ? 'true' : 'false'
  }
  return out
}

function parseResponseJson(raw) {
  if (!raw) return { values: {}, flow_id: undefined }
  let parsed
  if (typeof raw === 'object') parsed = raw
  else {
    try {
      parsed = JSON.parse(raw)
    } catch {
      return { values: {}, flow_id: undefined }
    }
  }
  const nestedValues = parsed.values
  const flatValues =
    nestedValues &&
    typeof nestedValues === 'object' &&
    !Array.isArray(nestedValues)
      ? asStringRecord(nestedValues)
      : asStringRecord(parsed)
  const flow_id = typeof parsed.flow_id === 'string' ? parsed.flow_id : undefined
  return { values: flatValues, flow_id }
}

function formatFormFieldLabel(key) {
  const cleaned = key
    .replace(/^screen_\d+_/i, '')
    .replace(/_\d+$/, '')
    .replace(/_/g, ' ')
    .trim()
  if (!cleaned) return key
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function formatFlowFormValues(values) {
  const entries = Object.entries(values).filter(([, v]) => v.trim())
  if (entries.length === 0) return ''
  return entries.map(([k, v]) => `${formatFormFieldLabel(k)}: ${v}`).join('\n')
}

function parseFlowNfmReply(interactive) {
  if (!interactive || interactive.type !== 'nfm_reply') return null
  const reply = interactive.nfm_reply
  if (!reply) return null
  if (reply.name === 'address_message') return null

  const isFlow =
    reply.name === 'flow' ||
    reply.name === 'form' ||
    (!reply.name && reply.response_json != null)
  if (!isFlow && reply.name) return null

  const { values, flow_id } = parseResponseJson(reply.response_json)
  const hasValues = Object.keys(values).length > 0
  if (!hasValues && !(typeof reply.body === 'string' && reply.body.trim())) {
    return null
  }

  const formatted =
    (typeof reply.body === 'string' &&
    reply.body.trim() &&
    reply.body !== 'Sent'
      ? reply.body.trim()
      : '') ||
    formatFlowFormValues(values) ||
    '[Form submitted]'

  return {
    formatted,
    values,
    flow_id,
    form_name: reply.name,
  }
}

function normalizeReferral(raw) {
  if (!raw || typeof raw !== 'object') return null
  const pick = (k) => {
    const v = raw[k]
    return typeof v === 'string' && v.trim() ? v.trim() : undefined
  }
  const referral = {
    source_type: pick('source_type'),
    source_id: pick('source_id'),
    source_url: pick('source_url'),
    headline: pick('headline'),
    body: pick('body'),
    media_type: pick('media_type'),
    image_url: pick('image_url'),
    video_url: pick('video_url'),
    thumbnail_url: pick('thumbnail_url'),
    ctwa_clid: pick('ctwa_clid'),
  }
  return Object.values(referral).some(Boolean) ? referral : null
}

function contactUpdatesFromFormValues(values) {
  const out = {}
  const name =
    values.full_name?.trim() ||
    values.name?.trim() ||
    [values.first_name, values.last_name].filter(Boolean).join(' ').trim() ||
    values.customer_name?.trim()
  if (name) out.name = name

  const email =
    values.email?.trim() ||
    values.email_address?.trim() ||
    values.e_mail?.trim()
  if (email && email.includes('@')) out.email = email
  return out
}

function loadWebhookBodies(filePath) {
  const raw = readFileSync(filePath, 'utf8').trim()
  if (!raw) return []

  if (raw.startsWith('[')) {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : [parsed]
  }

  if (raw.startsWith('{') && raw.includes('"entry"')) {
    return [JSON.parse(raw)]
  }

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line))
}

function extractInboundEvents(body) {
  const events = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      if (!value?.messages?.length) continue
      for (let i = 0; i < value.messages.length; i++) {
        events.push({
          message: value.messages[i],
          contact: value.contacts?.[i] ?? value.contacts?.[0] ?? null,
          referral: value.messages[i].referral ?? null,
        })
      }
    }
  }
  return events
}

async function scanCandidates() {
  const { data, error } = await db
    .from('messages')
    .select('id, message_id, content_text, content_payload, created_at, conversation_id')
    .eq('content_type', 'interactive')
    .eq('sender_type', 'customer')
    .or(
      'content_payload.is.null,content_text.eq.[Interactive reply],content_text.eq.Sent',
    )
    .order('created_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('Scan failed:', error.message)
    process.exit(1)
  }

  const rows = data ?? []
  console.log(`Found ${rows.length} interactive customer message(s) without structured form data.`)
  if (rows.length === 0) return

  console.log('\nSample (up to 10):')
  for (const row of rows.slice(0, 10)) {
    console.log(
      `  ${row.id}  meta=${row.message_id ?? '—'}  text=${JSON.stringify(row.content_text)}  conv=${row.conversation_id}`,
    )
  }

  console.log(
    '\nThese rows cannot be repaired from the database alone.',
    'Export Meta webhook payloads and re-run with --file <path>.',
  )
}

async function backfillFromFile(filePath, dryRun) {
  const bodies = loadWebhookBodies(filePath)
  let parsedForms = 0
  let updatedMessages = 0
  let skippedExisting = 0
  let notFound = 0
  let referralsUpdated = 0
  let contactsUpdated = 0

  for (const body of bodies) {
    for (const event of extractInboundEvents(body)) {
      const { message } = event
      if (message.type !== 'interactive') continue

      const flowForm = parseFlowNfmReply(message.interactive)
      if (!flowForm) continue
      parsedForms++

      const metaId = message.id
      if (!metaId) continue

      const { data: existing, error: findErr } = await db
        .from('messages')
        .select('id, content_payload, content_text, conversation_id')
        .eq('message_id', metaId)
        .maybeSingle()

      if (findErr) {
        console.error('Lookup failed:', findErr.message)
        continue
      }
      if (!existing) {
        notFound++
        continue
      }

      const already =
        existing.content_payload &&
        typeof existing.content_payload === 'object' &&
        existing.content_payload.type === 'whatsapp_flow'
      if (already) {
        skippedExisting++
        continue
      }

      const contentPayload = {
        type: 'whatsapp_flow',
        formatted: flowForm.formatted,
        values: flowForm.values,
        ...(flowForm.flow_id ? { flow_id: flowForm.flow_id } : {}),
        ...(flowForm.form_name ? { form_name: flowForm.form_name } : {}),
      }

      if (dryRun) {
        console.log(
          `[dry-run] would update message ${existing.id} (${metaId}):`,
          flowForm.formatted.split('\n')[0],
        )
        updatedMessages++
        continue
      }

      const { error: updErr } = await db
        .from('messages')
        .update({
          content_text: flowForm.formatted,
          interactive_reply_id: flowForm.form_name ?? 'flow',
          content_payload: contentPayload,
        })
        .eq('id', existing.id)

      if (updErr) {
        console.error(`Update failed for ${existing.id}:`, updErr.message)
        continue
      }
      updatedMessages++

      const { data: conv } = await db
        .from('conversations')
        .select('contact_id')
        .eq('id', existing.conversation_id)
        .maybeSingle()

      const contactId = conv?.contact_id
      if (!contactId) continue

      const referral = normalizeReferral(event.referral)
      if (referral) {
        const { data: contact } = await db
          .from('contacts')
          .select('referral, name, email')
          .eq('id', contactId)
          .maybeSingle()

        if (contact && !contact.referral) {
          const { error: refErr } = await db
            .from('contacts')
            .update({ referral, updated_at: new Date().toISOString() })
            .eq('id', contactId)
          if (!refErr) referralsUpdated++
        }
      }

      const patch = contactUpdatesFromFormValues(flowForm.values)
      if (patch.name || patch.email) {
        const { data: contact } = await db
          .from('contacts')
          .select('name, email')
          .eq('id', contactId)
          .maybeSingle()
        if (contact) {
          const contactPatch = { updated_at: new Date().toISOString() }
          if (patch.name && !contact.name?.trim()) contactPatch.name = patch.name
          if (patch.email && !contact.email?.trim()) contactPatch.email = patch.email
          if (Object.keys(contactPatch).length > 1) {
            const { error: cErr } = await db
              .from('contacts')
              .update(contactPatch)
              .eq('id', contactId)
            if (!cErr) contactsUpdated++
          }
        }
      }
    }
  }

  console.log('\nBackfill summary:')
  console.log(`  Webhook bodies processed: ${bodies.length}`)
  console.log(`  Flow submissions parsed:   ${parsedForms}`)
  console.log(`  Messages updated:          ${updatedMessages}${dryRun ? ' (dry-run)' : ''}`)
  console.log(`  Already had form data:     ${skippedExisting}`)
  console.log(`  Meta id not in DB:         ${notFound}`)
  if (!dryRun) {
    console.log(`  Referrals backfilled:      ${referralsUpdated}`)
    console.log(`  Contacts enriched:         ${contactsUpdated}`)
  }
}

const args = process.argv.slice(2)
const fileIdx = args.indexOf('--file')
const filePath = fileIdx >= 0 ? args[fileIdx + 1] : null
const dryRun = args.includes('--dry-run')
const scan = args.includes('--scan') || !filePath

if (scan && !filePath) {
  await scanCandidates()
} else if (filePath) {
  await backfillFromFile(filePath, dryRun)
} else {
  console.error('Usage: node scripts/backfill-whatsapp-form-submissions.mjs [--scan] [--file path] [--dry-run]')
  process.exit(1)
}
