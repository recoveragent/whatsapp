import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
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
 * GET /api/leads/sources
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const { data, error } = await ctx.supabase
      .from('lead_sources')
      .select('*, cadence:cadences(id, name, kind)')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: true })

    if (error) {
      const hint = leadsMigrationMessage(error)
      return NextResponse.json(
        { error: hint ?? error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ sources: data ?? [] })
  } catch (err) {
    return sourceError(err)
  }
}

/**
 * POST /api/leads/sources
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null

    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const spreadsheetUrl =
      typeof body?.spreadsheet_url === 'string' ? body.spreadsheet_url.trim() : ''
    const spreadsheetId =
      parseSpreadsheetId(
        typeof body?.spreadsheet_id === 'string'
          ? body.spreadsheet_id
          : spreadsheetUrl,
      ) ?? ''
    const sheetName =
      typeof body?.sheet_name === 'string' ? body.sheet_name.trim() : ''
    const phoneColumn =
      typeof body?.phone_column === 'string' && body.phone_column.trim()
        ? body.phone_column.trim()
        : 'phone'
    const cadenceId =
      typeof body?.cadence_id === 'string' && body.cadence_id.trim()
        ? body.cadence_id.trim()
        : null

    if (!name) {
      return NextResponse.json({ error: 'Campaign name is required' }, { status: 400 })
    }
    if (!spreadsheetId) {
      return NextResponse.json({ error: 'Paste a valid Google Sheet URL' }, { status: 400 })
    }
    if (!sheetName) {
      return NextResponse.json({ error: 'Sheet tab is required' }, { status: 400 })
    }
    if (!cadenceId) {
      return NextResponse.json({ error: 'Pick a cadence for this campaign' }, { status: 400 })
    }

    const defaultLanguage = isLeadLanguage(body?.default_language)
      ? body.default_language
      : 'en'

    const { data, error } = await ctx.supabase
      .from('lead_sources')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        cadence_id: cadenceId,
        spreadsheet_id: spreadsheetId,
        spreadsheet_url: spreadsheetUrl || null,
        sheet_name: sheetName,
        phone_column: phoneColumn,
        name_column:
          typeof body?.name_column === 'string' ? body.name_column.trim() || null : null,
        email_column:
          typeof body?.email_column === 'string'
            ? body.email_column.trim() || null
            : null,
        language_column:
          typeof body?.language_column === 'string'
            ? body.language_column.trim() || null
            : null,
        default_language: defaultLanguage,
        sync_existing: Boolean(body?.sync_existing),
        active: true,
      })
      .select('*, cadence:cadences(id, name, kind)')
      .single()

    if (error) {
      const hint = leadsMigrationMessage(error)
      return NextResponse.json(
        { error: hint ?? error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ source: data })
  } catch (err) {
    return sourceError(err)
  }
}
