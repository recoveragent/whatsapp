import type { SupabaseClient } from '@supabase/supabase-js'

import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { refreshGoogleAccessToken } from './oauth'
import { quoteSheetName } from './parse-sheet-url'

export interface GoogleSheetsConfigRow {
  id: string
  account_id: string
  user_id: string
  access_token: string
  refresh_token: string
  token_expiry: string | null
  google_email: string | null
  scopes: string[] | null
  status: string
}

export interface SheetTabInfo {
  title: string
  sheetId: number
  index: number
}

export interface SheetPreview {
  spreadsheetId: string
  title: string
  tabs: SheetTabInfo[]
  headers: string[]
  sheetName: string
}

const TOKEN_SKEW_MS = 60_000

export async function getValidAccessToken(
  db: SupabaseClient,
  config: GoogleSheetsConfigRow,
): Promise<string> {
  const accessToken = decrypt(config.access_token)
  const expiry = config.token_expiry ? new Date(config.token_expiry).getTime() : 0
  if (expiry && expiry - TOKEN_SKEW_MS > Date.now()) {
    return accessToken
  }

  const refreshToken = decrypt(config.refresh_token)
  const refreshed = await refreshGoogleAccessToken(refreshToken)
  const newExpiry = refreshed.expires_in
    ? new Date(Date.now() + refreshed.expires_in * 1000)
    : null

  await db
    .from('google_sheets_config')
    .update({
      access_token: encrypt(refreshed.access_token),
      token_expiry: newExpiry?.toISOString() ?? null,
      status: 'connected',
    })
    .eq('account_id', config.account_id)

  return refreshed.access_token
}

async function sheetsFetch<T>(
  accessToken: string,
  path: string,
): Promise<T> {
  const res = await fetch(`https://sheets.googleapis.com/v4${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = (await res.json().catch(() => null)) as
    | (T & { error?: { message?: string } })
    | null
  if (!res.ok) {
    throw new Error(data?.error?.message || `Google Sheets API error (${res.status})`)
  }
  return data as T
}

export async function fetchSpreadsheetMeta(
  accessToken: string,
  spreadsheetId: string,
): Promise<{ title: string; tabs: SheetTabInfo[] }> {
  const data = await sheetsFetch<{
    properties?: { title?: string }
    sheets?: Array<{
      properties?: { title?: string; sheetId?: number; index?: number }
    }>
  }>(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties(title,sheetId,index)`,
  )

  const tabs: SheetTabInfo[] = (data.sheets ?? [])
    .map((s) => ({
      title: s.properties?.title ?? '',
      sheetId: s.properties?.sheetId ?? 0,
      index: s.properties?.index ?? 0,
    }))
    .filter((t) => t.title)

  return {
    title: data.properties?.title ?? spreadsheetId,
    tabs,
  }
}

export async function fetchSheetValues(
  accessToken: string,
  spreadsheetId: string,
  rangeA1: string,
): Promise<string[][]> {
  const encodedRange = encodeURIComponent(rangeA1)
  const data = await sheetsFetch<{ values?: string[][] }>(
    accessToken,
    `/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodedRange}?majorDimension=ROWS&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
  )
  return (data.values ?? []).map((row) =>
    row.map((cell) => (cell == null ? '' : String(cell))),
  )
}

export async function previewSpreadsheet(args: {
  accessToken: string
  spreadsheetId: string
  sheetName?: string
}): Promise<SheetPreview> {
  const meta = await fetchSpreadsheetMeta(args.accessToken, args.spreadsheetId)
  const sheetName =
    args.sheetName?.trim() ||
    meta.tabs[0]?.title ||
    'Sheet1'

  const headerRange = `${quoteSheetName(sheetName)}!1:1`
  const rows = await fetchSheetValues(
    args.accessToken,
    args.spreadsheetId,
    headerRange,
  )
  const headers = (rows[0] ?? []).map((h) => h.trim()).filter(Boolean)

  return {
    spreadsheetId: args.spreadsheetId,
    title: meta.title,
    tabs: meta.tabs,
    headers,
    sheetName,
  }
}

/**
 * 1-based last non-empty row index for a single column (header counts as row 1).
 * Trailing empty cells are omitted by the Sheets API, so `values.length` is the
 * last occupied row in that column — not the grid height.
 */
export async function getLastRowIndex(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  column = 'A',
): Promise<number> {
  const col = column.trim() || 'A'
  const range = `${quoteSheetName(sheetName)}!${col}:${col}`
  const rows = await fetchSheetValues(accessToken, spreadsheetId, range)
  return rows.length
}

export function rowToObject(
  headers: string[],
  values: string[],
): Record<string, string> {
  const obj: Record<string, string> = {}
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i]?.trim()
    if (!key) continue
    obj[key] = values[i] ?? ''
  }
  return obj
}

export function columnLetter(index0: number): string {
  let n = index0 + 1
  let s = ''
  while (n > 0) {
    const rem = (n - 1) % 26
    s = String.fromCharCode(65 + rem) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}
