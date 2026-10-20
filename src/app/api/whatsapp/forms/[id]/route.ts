import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import { FLOW_CATEGORIES, sanitizeFormDefinition } from '@/lib/whatsapp/form-builder'

/** Save edits locally. A published Meta Flow is untouched until re-publish. */
export async function PATCH(
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
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) {
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name || name.length > 120) {
      return NextResponse.json({ error: 'Form name is required (max 120 characters).' }, { status: 400 })
    }
    patch.name = name
  }
  if (body.category !== undefined) {
    if (!(FLOW_CATEGORIES as readonly string[]).includes(String(body.category))) {
      return NextResponse.json({ error: 'Unknown form category.' }, { status: 400 })
    }
    patch.category = body.category
  }
  if (body.waba_id !== undefined) patch.waba_id = body.waba_id ? String(body.waba_id) : null
  if (body.definition !== undefined) {
    patch.definition = sanitizeFormDefinition(body.definition)
    patch.has_unpublished_changes = true
  }

  const { data, error } = await supabaseAdmin()
    .from('whatsapp_forms')
    .update(patch)
    .eq('id', id)
    .eq('account_id', ctx.accountId)
    .select()
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Form not found' }, { status: 404 })
  return NextResponse.json({ form: data })
}

/** Remove the in-app copy. The Meta Flow stays (published Flows can only be deprecated in Meta). */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const { id } = await params
  const { error } = await supabaseAdmin()
    .from('whatsapp_forms')
    .delete()
    .eq('id', id)
    .eq('account_id', ctx.accountId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
