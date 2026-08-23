import { NextResponse } from 'next/server'

import { requireLeadGenAccount, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { parseSpreadsheetId } from '@/lib/google-sheets/parse-sheet-url'
import {
  getValidAccessToken,
  previewSpreadsheet,
  type GoogleSheetsConfigRow,
} from '@/lib/google-sheets/sheets-client'

/**
 * POST /api/google-sheets/preview
 * Body: { spreadsheet_url | spreadsheet_id, sheet_name? }
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireLeadGenAccount()
    const body = (await request.json().catch(() => null)) as {
      spreadsheet_url?: string
      spreadsheet_id?: string
      sheet_name?: string
    } | null

    const id =
      parseSpreadsheetId(body?.spreadsheet_id ?? '') ||
      parseSpreadsheetId(body?.spreadsheet_url ?? '')

    if (!id) {
      return NextResponse.json(
        { error: 'Paste a valid Google Sheet URL or spreadsheet id' },
        { status: 400 },
      )
    }

    const db = supabaseAdmin()
    const { data: config, error } = await db
      .from('google_sheets_config')
      .select('*')
      .eq('account_id', ctx.accountId)
      .eq('status', 'connected')
      .maybeSingle()

    if (error || !config) {
      return NextResponse.json(
        {
          error:
            'Connect Google Sheets in Settings before previewing a spreadsheet',
        },
        { status: 400 },
      )
    }

    const accessToken = await getValidAccessToken(
      db,
      config as GoogleSheetsConfigRow,
    )
    const preview = await previewSpreadsheet({
      accessToken,
      spreadsheetId: id,
      sheetName: body?.sheet_name,
    })

    return NextResponse.json(preview)
  } catch (err) {
    console.error('[google-sheets preview]', err)
    if (err && typeof err === 'object' && 'status' in err) {
      return toErrorResponse(err)
    }
    const message =
      err instanceof Error ? err.message : 'Failed to preview spreadsheet'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
