import type { SupabaseClient } from '@supabase/supabase-js'

import { appendStageMoveNote, resolveDealInsertTitle } from '@/lib/deals/display'
import {
  recordDealReceivedEvent,
  recordDealStageMoveEvent,
} from '@/lib/deals/stage-events'

export const DUPLICATE_LEAD_STAGE_MOVE_REASON = 'Duplicate lead submission'

export interface CreateOrMoveDealArgs {
  accountId: string
  userId: string
  contactId: string
  pipelineId: string
  stageId: string
  title: string
  value?: number
  currency?: string
}

export interface CreateOrMoveDealResult {
  dealId: string
  created: boolean
  moved: boolean
}

export async function createOrMoveDealForContact(
  db: SupabaseClient,
  args: CreateOrMoveDealArgs,
): Promise<CreateOrMoveDealResult> {
  const { data: existingDeal } = await db
    .from('deals')
    .select('id, stage_id, notes, status')
    .eq('account_id', args.accountId)
    .eq('contact_id', args.contactId)
    .eq('pipeline_id', args.pipelineId)
    .or('status.eq.open,status.is.null')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingDeal?.id) {
    const dealId = existingDeal.id as string
    const fromStageId = existingDeal.stage_id as string

    if (fromStageId === args.stageId) {
      return { dealId, created: false, moved: false }
    }

    const [{ data: fromStage }, { data: toStage }] = await Promise.all([
      db.from('pipeline_stages').select('name').eq('id', fromStageId).maybeSingle(),
      db.from('pipeline_stages').select('name').eq('id', args.stageId).maybeSingle(),
    ])

    const fromStageName = fromStage?.name ?? 'Unknown'
    const toStageName = toStage?.name ?? 'Unknown'
    const updatedNotes = appendStageMoveNote(
      (existingDeal.notes as string | null) ?? null,
      fromStageName,
      toStageName,
      DUPLICATE_LEAD_STAGE_MOVE_REASON,
    )
    const now = new Date().toISOString()

    const { error } = await db
      .from('deals')
      .update({
        stage_id: args.stageId,
        notes: updatedNotes,
        updated_at: now,
      })
      .eq('id', dealId)

    if (error) {
      throw new Error(error.message)
    }

    await recordDealStageMoveEvent(db, {
      dealId,
      accountId: args.accountId,
      fromStageId,
      toStageId: args.stageId,
      fromStageName,
      toStageName,
      reason: DUPLICATE_LEAD_STAGE_MOVE_REASON,
      userId: args.userId,
    })

    return { dealId, created: false, moved: true }
  }

  const { data: created, error } = await db
    .from('deals')
    .insert({
      account_id: args.accountId,
      user_id: args.userId,
      pipeline_id: args.pipelineId,
      stage_id: args.stageId,
      contact_id: args.contactId,
      title: args.title,
      value: args.value ?? 0,
      currency: args.currency ?? 'USD',
      status: 'open',
    })
    .select('id, created_at')
    .single()

  if (error || !created) {
    throw new Error(error?.message ?? 'deal insert failed')
  }

  const { data: stage } = await db
    .from('pipeline_stages')
    .select('name')
    .eq('id', args.stageId)
    .maybeSingle()

  await recordDealReceivedEvent(db, {
    dealId: created.id,
    accountId: args.accountId,
    stageId: args.stageId,
    stageName: stage?.name ?? 'Unknown',
    userId: args.userId,
    createdAt: created.created_at,
  })

  return { dealId: created.id, created: true, moved: false }
}

export async function resolveCreateDealTitle(
  db: SupabaseClient,
  args: {
    configuredTitle: string
    contactId: string
    stageId: string
  },
): Promise<string> {
  const [{ data: contact }, { data: stage }] = await Promise.all([
    db.from('contacts').select('name, phone').eq('id', args.contactId).maybeSingle(),
    db.from('pipeline_stages').select('name').eq('id', args.stageId).maybeSingle(),
  ])

  return resolveDealInsertTitle({
    configuredTitle: args.configuredTitle,
    contact,
    stageName: stage?.name,
  })
}
