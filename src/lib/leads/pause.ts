import type { SupabaseClient } from '@supabase/supabase-js'

import { patchContactLead } from './enroll'
import type { ExitReason, LeadStatus } from './types'

const TERMINAL: LeadStatus[] = [
  'meeting_booked',
  'onboarded',
  'lost',
  'expired',
]

export async function cancelOpenTasks(
  db: SupabaseClient,
  args: { accountId: string; contactId: string; enrollmentId?: string },
): Promise<void> {
  let query = db
    .from('crm_tasks')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .in('status', ['pending', 'claimed'])

  if (args.enrollmentId) {
    query = query.eq('enrollment_id', args.enrollmentId)
  }

  const { error } = await query
  if (error) {
    console.error('[leads] cancel tasks failed:', error.message)
  }
}

export async function exitEnrollment(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
  reason: ExitReason
  nextLeadStatus: LeadStatus
}): Promise<void> {
  const now = new Date().toISOString()

  const { data: active } = await args.db
    .from('cadence_enrollments')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'active')

  for (const row of active ?? []) {
    await args.db
      .from('cadence_enrollments')
      .update({
        status: 'exited',
        exit_reason: args.reason,
        paused_at: args.reason === 'replied' ? now : null,
        completed_at: now,
        next_run_at: null,
        claimed_until: null,
      })
      .eq('id', row.id)

    await cancelOpenTasks(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      enrollmentId: row.id as string,
    })
  }

  const { data: contact } = await args.db
    .from('contacts')
    .select('lead_status')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const current = (contact?.lead_status as LeadStatus | undefined) ?? 'new'
  if (!TERMINAL.includes(current) || args.nextLeadStatus === 'expired') {
    if (!(TERMINAL.includes(current) && args.nextLeadStatus === 'replied')) {
      await patchContactLead(args.db, {
        contactId: args.contactId,
        accountId: args.accountId,
        patch: {
          lead_status: args.nextLeadStatus,
          next_action_at: null,
          next_action_type: args.reason,
        },
      })
    }
  }
}

/** Customer inbound WhatsApp — stop the cadence, put them in Replied. */
export async function pauseCadenceOnReply(args: {
  db: SupabaseClient
  accountId: string
  contactId: string
}): Promise<void> {
  const now = new Date().toISOString()

  const { data: active } = await args.db
    .from('cadence_enrollments')
    .select('id')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('status', 'active')

  for (const row of active ?? []) {
    await args.db
      .from('cadence_enrollments')
      .update({
        status: 'paused',
        exit_reason: 'replied',
        paused_at: now,
        next_run_at: null,
        claimed_until: null,
      })
      .eq('id', row.id)

    await cancelOpenTasks(args.db, {
      accountId: args.accountId,
      contactId: args.contactId,
      enrollmentId: row.id as string,
    })
  }

  const { data: contact } = await args.db
    .from('contacts')
    .select('lead_status')
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
    .maybeSingle()

  const current = (contact?.lead_status as LeadStatus | undefined) ?? 'new'
  if (!TERMINAL.includes(current)) {
    await patchContactLead(args.db, {
      contactId: args.contactId,
      accountId: args.accountId,
      patch: {
        lead_status: 'replied',
        last_touch_at: now,
        next_action_at: now,
        next_action_type: 'respond',
      },
    })
  }
}
