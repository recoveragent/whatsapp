import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { accountIsLeadGen } from '@/lib/auth/brand-accounts'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  cloneTriggerConfigForCopy,
  insertFlowFromSnapshot,
  loadFlowSnapshot,
} from '@/lib/flows/clone-flow-snapshot'
import type { FlowTriggerType } from '@/lib/flows/trigger-types'

/**
 * POST /api/flows/[id]/duplicate — clone a flow and its nodes as a
 * new draft. Webhook tokens and sheet watermarks are reset so the copy
 * does not inherit live trigger state from the original.
 */

async function requireOwnership(
  flowId: string,
): Promise<
  | {
      ok: true
      userId: string
      supabase: Awaited<ReturnType<typeof createClient>>
    }
  | { ok: false; status: number; body: { error: string } }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, status: 401, body: { error: 'Unauthorized' } }
  }
  const { data: flow } = await supabase
    .from('flows')
    .select('id')
    .eq('id', flowId)
    .maybeSingle()
  if (!flow) {
    return { ok: false, status: 404, body: { error: 'Not found' } }
  }
  return { ok: true, userId: user.id, supabase }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params
  const guard = await requireOwnership(id)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const admin = supabaseAdmin()
  const { data: original, error: origErr } = await admin
    .from('flows')
    .select('id, account_id, trigger_type')
    .eq('id', id)
    .maybeSingle()
  if (origErr) return NextResponse.json({ error: origErr.message }, { status: 500 })
  if (!original) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const triggerType = original.trigger_type as FlowTriggerType
  if (
    triggerType === 'google_sheet_row' &&
    !(await accountIsLeadGen(guard.supabase, original.account_id as string))
  ) {
    return NextResponse.json(
      {
        error:
          'Google Sheet triggers are only available for lead generation brands',
      },
      { status: 403 },
    )
  }

  const snapshot = await loadFlowSnapshot(admin, id)
  if (!snapshot) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const created = await insertFlowFromSnapshot(admin, {
      accountId: original.account_id as string,
      userId: guard.userId,
      snapshot,
      name: `${snapshot.name} (Copy)`,
      resetTriggers: true,
    })

    const { data: copy } = await admin
      .from('flows')
      .select('*')
      .eq('id', created.id)
      .single()

    return NextResponse.json({ flow: copy }, { status: 201 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'copy failed' },
      { status: 500 },
    )
  }
}
