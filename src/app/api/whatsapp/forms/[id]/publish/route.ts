import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  buildFlowJson,
  sanitizeFormDefinition,
  validateFormDefinition,
} from '@/lib/whatsapp/form-builder'
import { MetaFlowsApiError, publishFormToMeta } from '@/lib/whatsapp/meta-flows-api'
import { loadAccountWabas } from '@/lib/whatsapp/waba-credentials'

interface FormRow {
  id: string
  name: string
  category: string
  definition: unknown
  waba_id: string | null
  meta_flow_id: string | null
  revision: number
  previous_flow_ids: string[] | null
}

/**
 * Upload the form to Meta as a WhatsApp Flow.
 * Body `{ publish: false }` stops at a validated DRAFT (testable via the
 * Send WhatsApp Form node's draft mode); default publishes it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const body = (await request.json().catch(() => ({}))) as { publish?: unknown }
  const publish = body.publish !== false

  const db = supabaseAdmin()
  const { data: form, error } = await db
    .from('whatsapp_forms')
    .select('id, name, category, definition, waba_id, meta_flow_id, revision, previous_flow_ids')
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .maybeSingle<FormRow>()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!form) return NextResponse.json({ error: 'Form not found' }, { status: 404 })

  const definition = sanitizeFormDefinition(form.definition)
  const issues = validateFormDefinition(definition)
  if (issues.length > 0) {
    return NextResponse.json({ error: issues[0]!.message, issues }, { status: 422 })
  }

  let wabas
  try {
    wabas = await loadAccountWabas(ctx.accountId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  const waba = form.waba_id ? wabas.find((w) => w.wabaId === form.waba_id) : wabas[0]
  if (!waba) {
    return NextResponse.json(
      {
        error: form.waba_id
          ? 'The WhatsApp Business account chosen for this form is no longer connected.'
          : 'WhatsApp not connected. Connect your WhatsApp Business account in Settings first.',
      },
      { status: 400 },
    )
  }

  // Only reuse a Flow on the same WABA; Meta names must be unique, so
  // each new Flow after the first gets a version suffix.
  const existingFlowId = form.waba_id === waba.wabaId || !form.waba_id ? form.meta_flow_id : null
  const metaName = form.revision === 0 ? form.name : `${form.name} v${form.revision + 1}`

  try {
    const result = await publishFormToMeta({
      wabaId: waba.wabaId,
      accessToken: waba.accessToken,
      existingFlowId,
      name: metaName,
      categories: [form.category],
      flowJson: buildFlowJson(definition),
      publish,
    })
    const previous = form.previous_flow_ids ?? []
    const replaced = result.created && form.meta_flow_id && form.meta_flow_id !== result.flowId
    const failed = result.validationErrors.length > 0
    const { data: updated, error: saveErr } = await db
      .from('whatsapp_forms')
      .update({
        waba_id: waba.wabaId,
        meta_flow_id: result.flowId,
        meta_status: result.status,
        revision: form.revision + (result.created ? 1 : 0),
        previous_flow_ids: replaced ? [...previous, form.meta_flow_id] : previous,
        has_unpublished_changes: result.status !== 'PUBLISHED',
        last_error: failed ? result.validationErrors.map((e) => e.message).join('\n') : null,
        ...(result.status === 'PUBLISHED' ? { published_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', form.id)
      .select()
      .single()
    if (saveErr) return NextResponse.json({ error: saveErr.message }, { status: 500 })
    if (failed) {
      return NextResponse.json(
        {
          error: 'Meta rejected the form. Fix the issues below and try again.',
          validation_errors: result.validationErrors,
          form: updated,
        },
        { status: 422 },
      )
    }
    return NextResponse.json({ form: updated, created: result.created })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await db
      .from('whatsapp_forms')
      .update({ last_error: message })
      .eq('id', form.id)
    if (err instanceof MetaFlowsApiError && err.permission) {
      return NextResponse.json({ error: message, permission: true }, { status: 403 })
    }
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
