import type { SupabaseClient } from '@supabase/supabase-js'

import { isUniqueViolation } from '@/lib/contacts/dedupe'

import { addMinutes } from './business-hours'
import type { CadenceEnrollment, CadenceStep, LeadStatus } from './types'

const PROTECTED_STATUSES: LeadStatus[] = [
  'replied',
  'meeting_booked',
  'onboarded',
  'lost',
]

export async function hasBlockingEnrollment(
  db: SupabaseClient,
  contactId: string,
): Promise<boolean> {
  const { data } = await db
    .from('cadence_enrollments')
    .select('id, status')
    .eq('contact_id', contactId)
    .in('status', ['active', 'paused'])
    .limit(1)
    .maybeSingle()
  return Boolean(data)
}

export async function patchContactLead(
  db: SupabaseClient,
  args: {
    contactId: string
    accountId: string
    patch: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await db
    .from('contacts')
    .update({ ...args.patch, updated_at: new Date().toISOString() })
    .eq('id', args.contactId)
    .eq('account_id', args.accountId)
  if (error) {
    console.error('[leads] contact patch failed:', error.message)
  }
}

export function firstStepRunAt(
  startedAt: Date,
  steps: Pick<CadenceStep, 'position' | 'delay_minutes'>[],
): { position: number; runAt: Date } | null {
  const ordered = [...steps].sort((a, b) => a.position - b.position)
  const first = ordered[0]
  if (!first) return null
  return { position: first.position, runAt: addMinutes(startedAt, first.delay_minutes) }
}

export async function enrollContact(args: {
  db: SupabaseClient
  accountId: string
  userId: string
  contactId: string
  cadenceId: string
  leadSourceId: string | null
  steps: Pick<CadenceStep, 'position' | 'delay_minutes'>[]
  currentLeadStatus?: string | null
}): Promise<{ enrollment: CadenceEnrollment | null; skipped: string | null }> {
  if (
    args.currentLeadStatus &&
    PROTECTED_STATUSES.includes(args.currentLeadStatus as LeadStatus)
  ) {
    return { enrollment: null, skipped: `lead_status=${args.currentLeadStatus}` }
  }

  if (await hasBlockingEnrollment(args.db, args.contactId)) {
    return { enrollment: null, skipped: 'already_enrolled' }
  }

  const startedAt = new Date()
  const first = firstStepRunAt(startedAt, args.steps)
  if (!first) {
    return { enrollment: null, skipped: 'cadence_has_no_steps' }
  }

  const { data, error } = await args.db
    .from('cadence_enrollments')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      contact_id: args.contactId,
      cadence_id: args.cadenceId,
      lead_source_id: args.leadSourceId,
      status: 'active',
      current_step_position: first.position,
      next_run_at: first.runAt.toISOString(),
      started_at: startedAt.toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    if (isUniqueViolation(error)) {
      return { enrollment: null, skipped: 'already_enrolled' }
    }
    console.error('[leads] enroll failed:', error.message)
    return { enrollment: null, skipped: error.message }
  }

  await patchContactLead(args.db, {
    contactId: args.contactId,
    accountId: args.accountId,
    patch: {
      lead_status: 'in_cadence',
      lead_source_id: args.leadSourceId,
      next_action_at: first.runAt.toISOString(),
      next_action_type: 'cadence',
    },
  })

  return { enrollment: data as CadenceEnrollment, skipped: null }
}
