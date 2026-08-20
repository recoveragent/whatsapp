import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { parseSpreadsheetId } from '@/lib/google-sheets/parse-sheet-url'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { isLeadLanguage } from '@/lib/leads/types'

function sourceError(err: unknown): NextResponse {
  if (err && typeof err === 'object' && 'message' in err) {
    const hint = leadsMigrationMessage(err as { message?: string; code?: string })
    if (hint) return NextResponse.json({ error: hint }, { status: 500 })
  }
  return toErrorResponse(err)
}

/**
 * PATCH /api/leads/sources/[id]
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string') patch.name = body.name.trim()
    if (typeof body.cadence_id === 'string') {
      patch.cadence_id = body.cadence_id.trim() || null
    }
    if (typeof body.spreadsheet_url === 'string') {
      const url = body.spreadsheet_url.trim()
      const sid = parseSpreadsheetId(url)
      if (!sid) {
        return NextResponse.json({ error: 'Paste a valid Google Sheet URL' }, { status: 400 })
      }
      patch.spreadsheet_url = url
      patch.spreadsheet_id = sid
    }
    if (typeof body.sheet_name === 'string') patch.sheet_name = body.sheet_name.trim()
    if (typeof body.phone_column === 'string') patch.phone_column = body.phone_column.trim()
    if (typeof body.name_column === 'string') {
      patch.name_column = body.name_column.trim() || null
    }
    if (typeof body.email_column === 'string') {
      patch.email_column = body.email_column.trim() || null
    }
    if (typeof body.language_column === 'string') {
      patch.language_column = body.language_column.trim() || null
    }
    if (isLeadLanguage(body.default_language)) {
      patch.default_language = body.default_language
    }
    if (typeof body.sync_existing === 'boolean') {
      patch.sync_existing = body.sync_existing
    }
    if (typeof body.active === 'boolean') patch.active = body.active
    if (body.reset_watermark === true) patch.last_processed_row = null

    const { data, error } = await ctx.supabase
      .from('lead_sources')
      .update(patch)
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .select('*, cadence:cadences(id, name, kind)')
      .maybeSingle()

    if (error) {
      const hint = leadsMigrationMessage(error)
      return NextResponse.json(
        { error: hint ?? error.message },
        { status: 500 },
      )
    }
    if (!data) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 })
    }
    return NextResponse.json({ source: data })
  } catch (err) {
    return sourceError(err)
  }
}

/**
 * DELETE /api/leads/sources/[id]
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const { error } = await ctx.supabase
      .from('lead_sources')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId)

    if (error) {
      const hint = leadsMigrationMessage(error)
      return NextResponse.json(
        { error: hint ?? error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return sourceError(err)
  }
}
