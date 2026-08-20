import type { SupabaseClient } from '@supabase/supabase-js'

import { DEFAULT_CADENCE_SEEDS } from './defaults'
import type { Cadence } from './types'

export async function ensureDefaultCadences(args: {
  db: SupabaseClient
  accountId: string
  userId: string
}): Promise<Cadence[]> {
  const { data: existing, error } = await args.db
    .from('cadences')
    .select('*')
    .eq('account_id', args.accountId)
    .order('created_at', { ascending: true })

  if (error) throw new Error(error.message)
  if (existing && existing.length > 0) return existing as Cadence[]

  const created: Cadence[] = []
  for (const seed of DEFAULT_CADENCE_SEEDS) {
    const { data: cadence, error: insertErr } = await args.db
      .from('cadences')
      .insert({
        account_id: args.accountId,
        user_id: args.userId,
        name: seed.name,
        kind: seed.kind,
        timezone: seed.timezone,
        call_hours_start: seed.call_hours_start,
        call_hours_end: seed.call_hours_end,
        call_days: seed.call_days,
        expire_after_days: seed.expire_after_days,
      })
      .select('*')
      .single()

    if (insertErr || !cadence) {
      throw new Error(insertErr?.message ?? 'Failed to create default cadence')
    }

    const { error: stepsErr } = await args.db.from('cadence_steps').insert(
      seed.steps.map((step) => ({
        cadence_id: cadence.id,
        position: step.position,
        delay_minutes: step.delay_minutes,
        channel: step.channel,
        template_name: step.template_name,
        script_en: step.script_en,
        script_hi: step.script_hi,
      })),
    )
    if (stepsErr) throw new Error(stepsErr.message)
    created.push(cadence as Cadence)
  }

  return created
}

export async function loadCadencesWithSteps(
  db: SupabaseClient,
  accountId: string,
): Promise<Cadence[]> {
  const { data: cadences, error } = await db
    .from('cadences')
    .select('*')
    .eq('account_id', accountId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)

  const list = (cadences as Cadence[] | null) ?? []
  if (list.length === 0) return []

  const ids = list.map((c) => c.id)
  const { data: steps, error: stepsErr } = await db
    .from('cadence_steps')
    .select('*')
    .in('cadence_id', ids)
    .order('position', { ascending: true })
  if (stepsErr) throw new Error(stepsErr.message)

  const byCadence = new Map<string, NonNullable<Cadence['steps']>>()
  for (const step of steps ?? []) {
    const cid = step.cadence_id as string
    const bucket = byCadence.get(cid) ?? []
    bucket.push(step as NonNullable<Cadence['steps']>[number])
    byCadence.set(cid, bucket)
  }

  return list.map((c) => ({ ...c, steps: byCadence.get(c.id) ?? [] }))
}
