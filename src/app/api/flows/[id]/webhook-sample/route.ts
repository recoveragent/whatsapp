import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import type { FlowWebhookTriggerConfig } from '@/lib/flows/webhook-config'
import { generateWebhookToken } from '@/lib/automations/webhook-token'

async function requireOwnedFlow(id: string, userId: string) {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('flows')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * GET /api/flows/[id]/webhook-sample
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const flow = await requireOwnedFlow(id, user.id)
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (flow.trigger_type !== 'webhook_received') {
    return NextResponse.json({ error: 'Not a webhook flow' }, { status: 400 })
  }

  const cfg = flow.trigger_config as FlowWebhookTriggerConfig
  return NextResponse.json({
    payload: cfg.last_received_payload ?? null,
    received_at: cfg.last_received_at ?? null,
    webhook_token: cfg.webhook_token ?? null,
  })
}

/**
 * POST /api/flows/[id]/webhook-sample — regenerate webhook token.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const flow = await requireOwnedFlow(id, user.id)
  if (!flow) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (flow.trigger_type !== 'webhook_received') {
    return NextResponse.json({ error: 'Not a webhook flow' }, { status: 400 })
  }

  const cfg = flow.trigger_config as FlowWebhookTriggerConfig
  const newToken = generateWebhookToken()
  const admin = supabaseAdmin()
  const { error } = await admin
    .from('flows')
    .update({
      trigger_config: { ...cfg, webhook_token: newToken },
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhook_token: newToken })
}
