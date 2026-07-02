import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import type { WebhookTriggerConfig } from '@/types'
import { generateWebhookToken } from '@/lib/automations/webhook-token'

async function requireOwnedAutomation(id: string, userId: string) {
  const admin = supabaseAdmin()
  const { data, error } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

/**
 * GET /api/automations/[id]/webhook-sample
 * Returns the last received webhook payload for mapping / testing.
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

  const automation = await requireOwnedAutomation(id, user.id)
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (automation.trigger_type !== 'webhook_received') {
    return NextResponse.json({ error: 'Not a webhook automation' }, { status: 400 })
  }

  const cfg = automation.trigger_config as WebhookTriggerConfig
  return NextResponse.json({
    payload: cfg.last_received_payload ?? null,
    received_at: cfg.last_received_at ?? null,
    webhook_token: cfg.webhook_token ?? null,
  })
}

/**
 * POST /api/automations/[id]/webhook-sample
 * Regenerate the webhook token (invalidates the old URL).
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

  const automation = await requireOwnedAutomation(id, user.id)
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (automation.trigger_type !== 'webhook_received') {
    return NextResponse.json({ error: 'Not a webhook automation' }, { status: 400 })
  }

  const cfg = automation.trigger_config as WebhookTriggerConfig
  const newToken = generateWebhookToken()
  const admin = supabaseAdmin()
  const { error } = await admin
    .from('automations')
    .update({
      trigger_config: { ...cfg, webhook_token: newToken },
    })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ webhook_token: newToken })
}
