/**
 * Diagnose a flow template send without contacting the customer.
 *
 * Reads flow_run_events (message_sent / error), checks whether the
 * WAMID landed in `messages`, and optionally backfills the inbox bubble.
 *
 * Usage:
 *   npx tsx scripts/diagnose-flow-send.ts --phone +919699956750
 *   npx tsx scripts/diagnose-flow-send.ts --run <flow_run_uuid>
 *   npx tsx scripts/diagnose-flow-send.ts --phone +919699956750 --repair
 *
 * Env (.env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1]?.trim() : undefined
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

async function main() {
  const phoneRaw = arg('phone')
  const runId = arg('run')
  const repair = hasFlag('repair')

  if (!phoneRaw && !runId) {
    console.error(
      'Usage: npx tsx scripts/diagnose-flow-send.ts --phone <e164> | --run <flow_run_id> [--repair]',
    )
    process.exit(1)
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const { supabaseAdmin } = await import('../src/lib/automations/admin-client')
  const { repairMissingFlowPromptForConversation } = await import(
    '../src/lib/flows/backfill-outbound-prompt'
  )
  const { canonicalContactPhone, normalizePhone } = await import(
    '../src/lib/whatsapp/phone-utils'
  )

  const db = supabaseAdmin()

  let runs: Array<{
    id: string
    status: string
    current_node_key: string | null
    conversation_id: string | null
    contact_id: string | null
    account_id: string
    started_at: string
    flow_id: string
  }> = []

  if (runId) {
    const { data, error } = await db
      .from('flow_runs')
      .select('id, status, current_node_key, conversation_id, contact_id, account_id, started_at, flow_id')
      .eq('id', runId)
      .maybeSingle()
    if (error || !data) {
      console.error('Flow run not found:', error?.message ?? runId)
      process.exit(1)
    }
    runs = [data]
  } else {
    const normalized = canonicalContactPhone(normalizePhone(phoneRaw!))
    const { data: contacts, error: contactErr } = await db
      .from('contacts')
      .select('id, phone, name, account_id')
      .eq('phone', normalized)

    if (contactErr || !contacts?.length) {
      console.error('No contact for phone:', phoneRaw, contactErr?.message)
      process.exit(1)
    }

    console.info(
      'Contacts:',
      contacts.map((c) => `${c.name ?? '?'} (${c.id})`).join(', '),
    )

    const contactIds = contacts.map((c) => c.id as string)
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const { data, error } = await db
      .from('flow_runs')
      .select('id, status, current_node_key, conversation_id, contact_id, account_id, started_at, flow_id')
      .in('contact_id', contactIds)
      .gte('started_at', since)
      .order('started_at', { ascending: false })
      .limit(10)

    if (error) {
      console.error('Failed to load flow runs:', error.message)
      process.exit(1)
    }
    runs = data ?? []
  }

  if (runs.length === 0) {
    console.info('No flow runs found in the last 7 days.')
    process.exit(0)
  }

  for (const run of runs) {
    const { data: flow } = await db
      .from('flows')
      .select('name')
      .eq('id', run.flow_id)
      .maybeSingle()

    const { data: contact } = run.contact_id
      ? await db
          .from('contacts')
          .select('name, phone')
          .eq('id', run.contact_id)
          .maybeSingle()
      : { data: null }

    console.info('\n' + '='.repeat(60))
    console.info('Flow run:', run.id)
    console.info('Flow:', (flow as { name?: string } | null)?.name ?? run.flow_id)
    console.info('Contact:', contact ? `${contact.name} (${contact.phone})` : run.contact_id)
    console.info('Status:', run.status, 'at node:', run.current_node_key)
    console.info('Conversation:', run.conversation_id)
    console.info('Started:', run.started_at)

    const { data: events } = await db
      .from('flow_run_events')
      .select('event_type, node_key, payload, created_at')
      .eq('flow_run_id', run.id)
      .order('created_at', { ascending: true })

    const sentEvents = (events ?? []).filter((e) => e.event_type === 'message_sent')
    const errorEvents = (events ?? []).filter((e) => e.event_type === 'error')

    if (errorEvents.length) {
      console.info('\nErrors:')
      for (const e of errorEvents) {
        console.info(' ', e.created_at, e.node_key, JSON.stringify(e.payload))
      }
    }

    if (!sentEvents.length) {
      console.info('\nNo message_sent events — Meta API was never called successfully.')
      continue
    }

    console.info('\nMeta sends (from flow log):')
    for (const e of sentEvents) {
      const payload = (e.payload ?? {}) as Record<string, unknown>
      const wamid =
        typeof payload.whatsapp_message_id === 'string'
          ? payload.whatsapp_message_id
          : null
      console.info(' ', e.created_at, e.node_key, wamid ?? '(no wamid in payload)')

      if (!wamid) continue

      const { data: inThread } = await db
        .from('messages')
        .select('id, conversation_id, status, error_message, created_at')
        .eq('message_id', wamid)
        .maybeSingle()

      if (inThread) {
        console.info('    ✓ In messages table:', {
          id: inThread.id,
          conversation_id: inThread.conversation_id,
          status: inThread.status,
          error_message: inThread.error_message,
        })
        if (
          run.conversation_id &&
          inThread.conversation_id !== run.conversation_id
        ) {
          console.warn(
            '    ⚠ Message is on a DIFFERENT conversation than this flow run.',
          )
        }
      } else {
        console.warn(
          '    ✗ NOT in messages table — Meta accepted the send but inbox DB insert failed or was never run.',
        )
        console.info(
          '      → Customer may still have received it on WhatsApp; inbox just has no bubble.',
        )
      }
    }

    const { count: threadMsgCount } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', run.conversation_id ?? '')

    console.info('\nInbox thread message count:', threadMsgCount ?? 0)

    let repairConversationId = run.conversation_id
    if (!repairConversationId && run.contact_id) {
      const { ensureConversationForContact } = await import(
        '@/lib/inbox/ensure-conversation'
      )
      const { data: flowRow } = await db
        .from('flows')
        .select('user_id')
        .eq('id', run.flow_id)
        .maybeSingle()
      if (flowRow?.user_id) {
        const conv = await ensureConversationForContact(
          db,
          run.account_id,
          flowRow.user_id as string,
          run.contact_id,
        )
        repairConversationId = conv?.id ?? null
        if (repairConversationId && !run.conversation_id) {
          await db
            .from('flow_runs')
            .update({ conversation_id: repairConversationId })
            .eq('id', run.id)
          console.info('Re-linked flow run to conversation:', repairConversationId)
        }
      }
    }

    if (repair && repairConversationId && run.contact_id) {
      const repairedId = await repairMissingFlowPromptForConversation({
        db,
        accountId: run.account_id,
        conversationId: repairConversationId,
        contactId: run.contact_id,
      })
      if (repairedId) {
        console.info('Repair: backfilled message id', repairedId)
      } else {
        console.info('Repair: nothing to backfill (or backfill failed)')
      }
    }
  }

  console.info('\n' + '='.repeat(60))
  console.info('Interpretation:')
  console.info('  message_sent + WAMID present  → Meta API accepted the outbound send')
  console.info('  NOT in messages table         → inbox gap (use --repair or reopen thread)')
  console.info('  To verify phone delivery      → Meta Business Suite → WhatsApp Manager → Message logs')
  console.info('                                  (search by phone / date; no customer contact needed)')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
