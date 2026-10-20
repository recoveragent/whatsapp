import { NextResponse } from 'next/server'
import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/flows/admin-client'
import {
  defaultFormDefinition,
  FLOW_CATEGORIES,
  sanitizeFormDefinition,
} from '@/lib/whatsapp/form-builder'

// WhatsApp Forms designed in-app. GET lists (RLS-scoped read);
// POST creates a local draft — nothing reaches Meta until publish.

export async function GET() {
  try {
    const { supabase } = await getCurrentAccount()
    const { data, error } = await supabase
      .from('whatsapp_forms')
      .select('*')
      .order('updated_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ forms: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  let ctx
  try {
    ctx = await requireRole('agent')
  } catch (err) {
    return toErrorResponse(err)
  }
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  if (!name || name.length > 120) {
    return NextResponse.json({ error: 'Form name is required (max 120 characters).' }, { status: 400 })
  }
  const category = (FLOW_CATEGORIES as readonly string[]).includes(String(body.category))
    ? String(body.category)
    : 'LEAD_GENERATION'
  const definition = body.definition ? sanitizeFormDefinition(body.definition) : defaultFormDefinition()

  const { data, error } = await supabaseAdmin()
    .from('whatsapp_forms')
    .insert({ account_id: ctx.accountId, created_by: ctx.userId, name, category, definition })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ form: data }, { status: 201 })
}
