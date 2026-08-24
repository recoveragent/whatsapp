import { NextResponse } from 'next/server'
import {
  ForbiddenError,
  getCurrentAccount,
  toErrorResponse,
} from '@/lib/auth/account'
import { canEditSettings } from '@/lib/auth/roles'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const ctx = await getCurrentAccount()
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('Only admins can manage WhatsApp Flows')
    }

    const { error } = await ctx.supabase
      .from('whatsapp_flows')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const ctx = await getCurrentAccount()
    if (!canEditSettings(ctx.role)) {
      throw new ForbiddenError('Only admins can manage WhatsApp Flows')
    }

    const body = await request.json()
    const {
      name,
      flow_id,
      flow_cta,
      body_text,
      header_text,
      footer_text,
      flow_screen,
      flow_message_version,
    } = body

    if (!name?.trim() || !flow_id?.trim() || !body_text?.trim()) {
      return NextResponse.json(
        { error: 'name, flow_id, and body_text are required' },
        { status: 400 },
      )
    }

    const { data, error } = await ctx.supabase
      .from('whatsapp_flows')
      .update({
        name: name.trim(),
        flow_id: flow_id.trim(),
        flow_cta: (flow_cta?.trim() || 'Open form'),
        body_text: body_text.trim(),
        header_text: header_text?.trim() || null,
        footer_text: footer_text?.trim() || null,
        flow_screen: flow_screen?.trim() || null,
        flow_message_version: flow_message_version?.trim() || '3',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select()
      .single()

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A flow with this name already exists' },
          { status: 409 },
        )
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
  } catch (error) {
    return toErrorResponse(error)
  }
}
