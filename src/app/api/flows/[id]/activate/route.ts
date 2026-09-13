import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { defaultCheckoutAppTriggerConfig } from '@/lib/flows/checkout-app-webhook'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { ensureFlowWebhookConfig } from '@/lib/flows/webhook-config'
import { validateFlowForActivation } from '@/lib/flows/validate'

/**
 * POST /api/flows/[id]/activate
 *
 * Body: { status: 'draft' | 'active' | 'archived' }
 *
 * Activating runs the full validator and refuses on any 'error'
 * severity issue. Drafts and archives are unconditional — users
 * need to be able to save broken-work-in-progress and pause flows
 * without first fixing them.
 *
 * Returns the updated flow on success; on validation failure returns
 * the full issue list so the builder can highlight each problem.
 */

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params

  // Changing status (activate / draft / archive) is a write — the RLS
  // flows_update policy requires `agent`, but the service-role client
  // below bypasses RLS, so enforce the role here (a viewer passes the
  // membership-only ownership check).
  try {
    await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { status?: 'draft' | 'active' | 'archived' }
    | null
  const status = body?.status
  if (!status || !['draft', 'active', 'archived'].includes(status)) {
    return NextResponse.json(
      { error: "status must be one of 'draft' | 'active' | 'archived'" },
      { status: 400 },
    )
  }

  // Ownership via RLS — caller's client.
  const { data: existing } = await supabase
    .from('flows')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const admin = supabaseAdmin()
  let triggerConfigPatch: Record<string, unknown> | undefined

  if (status === 'active') {
    // Re-load with the full payload the validator needs.
    const [{ data: flow }, { data: nodes }] = await Promise.all([
      admin
        .from('flows')
        .select('name, trigger_type, trigger_config, exit_config, entry_node_id')
        .eq('id', id)
        .maybeSingle(),
      admin
        .from('flow_nodes')
        .select('node_key, node_type, config')
        .eq('flow_id', id),
    ])
    if (!flow) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    const issues = validateFlowForActivation(
      flow as {
        name: string
        trigger_type: import('@/lib/flows/trigger-types').FlowTriggerType
        trigger_config: Record<string, unknown>
        exit_config?: Record<string, unknown> | null
        entry_node_id: string | null
      },
      (nodes ?? []) as Array<{
        node_key: string
        node_type: string
        config: Record<string, unknown>
      }>,
    )
    const blockers = issues.filter((i) => i.severity === 'error')
    if (blockers.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot activate flow — fix the issues below first.',
          issues,
        },
        { status: 422 },
      )
    }

    // Re-ensure webhook trigger config on activate (same as PUT) so a
    // resume after pause doesn't rely on a separate save having run.
    if (
      flow.trigger_type === 'shopify_checkout_app_abandoned' ||
      flow.trigger_type === 'webhook_received'
    ) {
      const prev = flow.trigger_config as Record<string, unknown> | null
      let ensured = ensureFlowWebhookConfig({
        ...(flow.trigger_type === 'shopify_checkout_app_abandoned'
          ? defaultCheckoutAppTriggerConfig()
          : {}),
        ...(prev ?? {}),
      }) as unknown as Record<string, unknown>
      if (
        prev?.last_received_payload != null &&
        ensured.last_received_payload == null
      ) {
        ensured = {
          ...ensured,
          last_received_payload: prev.last_received_payload,
          last_received_at: prev.last_received_at,
        }
      }
      triggerConfigPatch = ensured
    }
  }

  const flowPatch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  }
  if (triggerConfigPatch) {
    flowPatch.trigger_config = triggerConfigPatch
  }

  const { data: updated, error } = await admin
    .from('flows')
    .update(flowPatch)
    .eq('id', id)
    .select()
    .maybeSingle()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json({ flow: updated })
}
