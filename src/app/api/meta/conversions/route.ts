import { NextResponse } from 'next/server'

import {
  requireLeadGenAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { fetchWabaDatasetId } from '@/lib/meta/conversions-api'
import { decrypt } from '@/lib/whatsapp/encryption'

const CONFIG_SELECT =
  'enabled, dataset_id, crm_dataset_id, test_event_code, partner_agent, send_on_replied, send_on_qualified, send_on_not_interested, send_on_wrong_number, send_on_instant_form_lead'

export async function GET() {
  try {
    const ctx = await requireLeadGenAccount()

    const { data: config, error } = await ctx.supabase
      .from('meta_conversions_config')
      .select(CONFIG_SELECT)
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    if (error) {
      console.error('[GET /api/meta/conversions]', error)
      return NextResponse.json(
        { error: 'Failed to load Meta conversions settings' },
        { status: 500 },
      )
    }

    const { data: waConfig } = await ctx.supabase
      .from('whatsapp_config')
      .select('waba_id, status')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const { count: sentCount } = await ctx.supabase
      .from('meta_conversion_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('status', 'sent')

    const { count: skippedCount } = await ctx.supabase
      .from('meta_conversion_events')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', ctx.accountId)
      .eq('status', 'skipped')

    return NextResponse.json({
      configured: Boolean(config),
      enabled: config?.enabled ?? false,
      dataset_id: config?.dataset_id ?? null,
      crm_dataset_id: config?.crm_dataset_id ?? null,
      test_event_code: config?.test_event_code ?? null,
      partner_agent: config?.partner_agent ?? 'recoveragent',
      send_on_replied: config?.send_on_replied ?? true,
      send_on_qualified: config?.send_on_qualified ?? true,
      send_on_not_interested: config?.send_on_not_interested ?? true,
      send_on_wrong_number: config?.send_on_wrong_number ?? true,
      send_on_instant_form_lead: config?.send_on_instant_form_lead ?? true,
      whatsapp_connected: waConfig?.status === 'connected' && Boolean(waConfig?.waba_id),
      waba_id: waConfig?.waba_id ?? null,
      stats: {
        sent: sentCount ?? 0,
        skipped: skippedCount ?? 0,
      },
    })
  } catch (err) {
    return toErrorResponse(err)
  }
}

interface PatchBody {
  enabled?: boolean
  dataset_id?: string | null
  crm_dataset_id?: string | null
  test_event_code?: string | null
  send_on_replied?: boolean
  send_on_qualified?: boolean
  send_on_not_interested?: boolean
  send_on_wrong_number?: boolean
  send_on_instant_form_lead?: boolean
  refresh_dataset?: boolean
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireLeadGenAccount('admin')
    const body = (await request.json()) as PatchBody

    const { data: existing } = await ctx.supabase
      .from('meta_conversions_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .maybeSingle()

    const patch: Record<string, unknown> = {
      account_id: ctx.accountId,
    }

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
    if (body.dataset_id !== undefined) {
      patch.dataset_id = body.dataset_id?.trim() || null
    }
    if (body.crm_dataset_id !== undefined) {
      patch.crm_dataset_id = body.crm_dataset_id?.trim() || null
    }
    if (body.test_event_code !== undefined) {
      patch.test_event_code = body.test_event_code?.trim() || null
    }
    if (typeof body.send_on_replied === 'boolean') {
      patch.send_on_replied = body.send_on_replied
    }
    if (typeof body.send_on_qualified === 'boolean') {
      patch.send_on_qualified = body.send_on_qualified
    }
    if (typeof body.send_on_not_interested === 'boolean') {
      patch.send_on_not_interested = body.send_on_not_interested
    }
    if (typeof body.send_on_wrong_number === 'boolean') {
      patch.send_on_wrong_number = body.send_on_wrong_number
    }
    if (typeof body.send_on_instant_form_lead === 'boolean') {
      patch.send_on_instant_form_lead = body.send_on_instant_form_lead
    }

    if (body.refresh_dataset) {
      const { data: waConfig } = await ctx.supabase
        .from('whatsapp_config')
        .select('waba_id, access_token')
        .eq('account_id', ctx.accountId)
        .maybeSingle()

      if (!waConfig?.waba_id || !waConfig.access_token) {
        return NextResponse.json(
          { error: 'Connect WhatsApp before refreshing the Meta dataset.' },
          { status: 400 },
        )
      }

      const accessToken = decrypt(waConfig.access_token as string)
      const fetched = await fetchWabaDatasetId({
        wabaId: waConfig.waba_id as string,
        accessToken,
      })
      if (!fetched.ok) {
        return NextResponse.json({ error: fetched.error }, { status: 502 })
      }
      patch.dataset_id = fetched.datasetId
    }

    const { data, error } = await ctx.supabase
      .from('meta_conversions_config')
      .upsert(
        {
          ...existing,
          ...patch,
          account_id: ctx.accountId,
        },
        { onConflict: 'account_id' },
      )
      .select(CONFIG_SELECT)
      .single()

    if (error) {
      console.error('[PATCH /api/meta/conversions]', error)
      return NextResponse.json(
        { error: 'Failed to save Meta conversions settings' },
        { status: 500 },
      )
    }

    return NextResponse.json({ ok: true, config: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}
