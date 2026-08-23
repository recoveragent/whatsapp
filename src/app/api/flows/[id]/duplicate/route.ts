import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { accountIsLeadGen } from '@/lib/auth/brand-accounts'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { ensureFlowWebhookConfig } from '@/lib/flows/webhook-config'
import { generateWebhookToken } from '@/lib/automations/webhook-token'
import {
  ensureGoogleSheetRowConfig,
  type GoogleSheetRowTriggerConfig,
} from '@/lib/google-sheets/trigger-config'
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

function cloneTriggerConfig(
  triggerType: FlowTriggerType,
  triggerConfig: Record<string, unknown> | null,
): Record<string, unknown> {
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'webhook_received') {
    const ensured = ensureFlowWebhookConfig(cfg)
    return {
      ...ensured,
      webhook_token: generateWebhookToken(),
      last_received_payload: undefined,
      last_received_at: undefined,
    }
  }

  if (triggerType === 'google_sheet_row') {
    const ensured = ensureGoogleSheetRowConfig(cfg)
    return cloneGoogleSheetTriggerConfig(ensured)
  }

  return cfg
}

function cloneGoogleSheetTriggerConfig(
  config: GoogleSheetRowTriggerConfig,
): Record<string, unknown> {
  return {
    sources: config.sources.map(({ last_processed_row: _row, ...source }) => ({
      ...source,
    })),
  }
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
    .select('*')
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
  const triggerConfig = cloneTriggerConfig(
    triggerType,
    original.trigger_config as Record<string, unknown> | null,
  )

  const { data: copy, error: copyErr } = await admin
    .from('flows')
    .insert({
      account_id: original.account_id,
      user_id: guard.userId,
      name: `${original.name} (Copy)`,
      description: original.description,
      status: 'draft',
      trigger_type: original.trigger_type,
      trigger_config: triggerConfig,
      entry_node_id: original.entry_node_id,
      fallback_policy: original.fallback_policy,
      exit_config: original.exit_config,
    })
    .select()
    .single()
  if (copyErr || !copy) {
    return NextResponse.json(
      { error: copyErr?.message ?? 'copy failed' },
      { status: 500 },
    )
  }

  const { data: nodes, error: nodesErr } = await admin
    .from('flow_nodes')
    .select('node_key, node_type, config, position_x, position_y')
    .eq('flow_id', id)
    .order('created_at', { ascending: true })
  if (nodesErr) {
    await admin.from('flows').delete().eq('id', copy.id)
    return NextResponse.json({ error: nodesErr.message }, { status: 500 })
  }

  if (nodes && nodes.length > 0) {
    const { error: insErr } = await admin.from('flow_nodes').insert(
      nodes.map((n) => ({
        flow_id: copy.id,
        node_key: n.node_key,
        node_type: n.node_type,
        config: n.config,
        position_x: n.position_x ?? 0,
        position_y: n.position_y ?? 0,
      })),
    )
    if (insErr) {
      await admin.from('flows').delete().eq('id', copy.id)
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }
  }

  return NextResponse.json({ flow: copy }, { status: 201 })
}
