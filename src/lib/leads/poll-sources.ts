import type { SupabaseClient } from '@supabase/supabase-js'

import { leadGenAccountIds } from '@/lib/auth/brand-accounts'
import { ensureShopifyContact } from '@/lib/shopify/ensure-contact'
import {
  columnLetter,
  fetchSheetValues,
  getLastRowIndex,
  getValidAccessToken,
  rowToObject,
  type GoogleSheetsConfigRow,
} from '@/lib/google-sheets/sheets-client'
import { quoteSheetName } from '@/lib/google-sheets/parse-sheet-url'

import { enrollContact, patchContactLead } from './enroll'
import { inferLeadLanguage } from './language'
import type { CadenceStep, LeadLanguage, LeadSource } from './types'

/** Cap enrollments per cron tick so a 200-row backfill cannot time out. */
export const MAX_ENROLLS_PER_POLL = 12

export interface LeadPollResult {
  sources_checked: number
  rows_processed: number
  enrolled: number
  skipped: number
  errors: string[]
}

interface Budget {
  remaining: number
}

async function lastOccupiedRow(
  accessToken: string,
  spreadsheetId: string,
  sheetName: string,
  headers: string[],
  phoneColumn: string,
): Promise<number> {
  const phoneIdx = headers.findIndex((h) => h === phoneColumn)
  const phoneCol = phoneIdx >= 0 ? columnLetter(phoneIdx) : 'A'
  const [fromA, fromPhone] = await Promise.all([
    getLastRowIndex(accessToken, spreadsheetId, sheetName, 'A'),
    phoneCol === 'A'
      ? Promise.resolve(0)
      : getLastRowIndex(accessToken, spreadsheetId, sheetName, phoneCol),
  ])
  return Math.max(fromA, fromPhone)
}

async function loadCadenceSteps(
  db: SupabaseClient,
  cadenceId: string,
): Promise<CadenceStep[]> {
  const { data } = await db
    .from('cadence_steps')
    .select('id, cadence_id, position, delay_minutes, channel, template_name, script_en, script_hi, created_at')
    .eq('cadence_id', cadenceId)
    .order('position', { ascending: true })
  return (data as CadenceStep[] | null) ?? []
}

async function persistWatermark(
  db: SupabaseClient,
  sourceId: string,
  row: number,
): Promise<void> {
  await db
    .from('lead_sources')
    .update({ last_processed_row: row })
    .eq('id', sourceId)
}

async function processSource(
  db: SupabaseClient,
  config: GoogleSheetsConfigRow,
  source: LeadSource,
  accessToken: string,
  budget: Budget,
): Promise<{ rows: number; enrolled: number; skipped: number; error?: string }> {
  if (!source.spreadsheet_id || !source.sheet_name || !source.phone_column) {
    return {
      rows: 0,
      enrolled: 0,
      skipped: 0,
      error: `Source "${source.name}": incomplete sheet config`,
    }
  }
  if (!source.cadence_id) {
    return {
      rows: 0,
      enrolled: 0,
      skipped: 0,
      error: `Source "${source.name}": pick a cadence`,
    }
  }

  const headerRange = `${quoteSheetName(source.sheet_name)}!1:1`
  const headerRows = await fetchSheetValues(
    accessToken,
    source.spreadsheet_id,
    headerRange,
  )
  const headers = (headerRows[0] ?? []).map((h) => h.trim())
  if (headers.length === 0) {
    return {
      rows: 0,
      enrolled: 0,
      skipped: 0,
      error: `Source "${source.name}": empty header row`,
    }
  }
  if (!headers.includes(source.phone_column)) {
    return {
      rows: 0,
      enrolled: 0,
      skipped: 0,
      error: `Source "${source.name}": phone column "${source.phone_column}" not in header`,
    }
  }

  const lastRow = await lastOccupiedRow(
    accessToken,
    source.spreadsheet_id,
    source.sheet_name,
    headers,
    source.phone_column,
  )

  if (lastRow <= 1) {
    if (source.last_processed_row == null) {
      await persistWatermark(db, source.id, 1)
    }
    return { rows: 0, enrolled: 0, skipped: 0 }
  }

  let watermark = source.last_processed_row
  if (watermark == null) {
    if (source.sync_existing) {
      watermark = 1
    } else {
      await persistWatermark(db, source.id, lastRow)
      return { rows: 0, enrolled: 0, skipped: 0 }
    }
  }

  if (watermark >= lastRow) {
    return { rows: 0, enrolled: 0, skipped: 0 }
  }

  const steps = await loadCadenceSteps(db, source.cadence_id)
  if (steps.length === 0) {
    return {
      rows: 0,
      enrolled: 0,
      skipped: 0,
      error: `Source "${source.name}": cadence has no steps`,
    }
  }

  const startRow = watermark + 1
  const endCol = columnLetter(Math.max(headers.length - 1, 0))
  const dataRange = `${quoteSheetName(source.sheet_name)}!A${startRow}:${endCol}${lastRow}`
  const dataRows = await fetchSheetValues(
    accessToken,
    source.spreadsheet_id,
    dataRange,
  )

  let enrolled = 0
  let skipped = 0
  let processedThrough = watermark

  for (let i = 0; i < dataRows.length; i++) {
    if (budget.remaining <= 0) break
    const absoluteRow = startRow + i
    const rowObj = rowToObject(headers, dataRows[i] ?? [])
    const phoneRaw = (rowObj[source.phone_column] ?? '').trim()

    if (!phoneRaw) {
      skipped += 1
      processedThrough = absoluteRow
      await persistWatermark(db, source.id, absoluteRow)
      continue
    }

    const nameCol = source.name_column?.trim()
    const name = nameCol ? (rowObj[nameCol] ?? '').trim() : ''
    const emailCol = source.email_column?.trim()
    const email = emailCol ? (rowObj[emailCol] ?? '').trim() : ''
    const langCol = source.language_column?.trim()
    const language: LeadLanguage = inferLeadLanguage(
      langCol ? rowObj[langCol] : '',
      source.default_language,
    )

    const contact = await ensureShopifyContact(
      db,
      source.account_id,
      config.user_id,
      phoneRaw,
      name || phoneRaw,
    )
    if (!contact) {
      skipped += 1
      processedThrough = absoluteRow
      await persistWatermark(db, source.id, absoluteRow)
      continue
    }

    const { data: existing } = await db
      .from('contacts')
      .select('lead_status, email, lead_language, lead_source_id')
      .eq('id', contact.id)
      .maybeSingle()

    const patch: Record<string, unknown> = {}
    if (email && !existing?.email) patch.email = email
    if (!existing?.lead_language) patch.lead_language = language
    if (!existing?.lead_source_id) patch.lead_source_id = source.id
    if (Object.keys(patch).length > 0) {
      await patchContactLead(db, {
        contactId: contact.id,
        accountId: source.account_id,
        patch,
      })
    }

    const outcome = await enrollContact({
      db,
      accountId: source.account_id,
      userId: config.user_id,
      contactId: contact.id,
      cadenceId: source.cadence_id,
      leadSourceId: source.id,
      steps,
      currentLeadStatus: (existing?.lead_status as string | null) ?? null,
    })

    budget.remaining -= 1
    if (outcome.enrollment) enrolled += 1
    else skipped += 1

    processedThrough = absoluteRow
    await persistWatermark(db, source.id, absoluteRow)
  }

  return {
    rows: Math.max(0, processedThrough - watermark),
    enrolled,
    skipped,
  }
}

export async function pollLeadSources(
  db: SupabaseClient,
  opts?: { accountId?: string; maxEnrolls?: number },
): Promise<LeadPollResult> {
  const result: LeadPollResult = {
    sources_checked: 0,
    rows_processed: 0,
    enrolled: 0,
    skipped: 0,
    errors: [],
  }

  let query = db.from('lead_sources').select('*').eq('active', true)
  if (opts?.accountId) query = query.eq('account_id', opts.accountId)

  const { data: sources, error } = await query

  if (error) {
    result.errors.push(error.message)
    return result
  }

  const list = (sources as LeadSource[] | null) ?? []
  if (list.length === 0) return result

  const allowed = opts?.accountId
    ? new Set([opts.accountId])
    : await leadGenAccountIds(
        db,
        list.map((s) => s.account_id),
      )
  const leadGenList = list.filter((s) => allowed.has(s.account_id))
  if (leadGenList.length === 0) return result

  const accountIds = [...new Set(leadGenList.map((s) => s.account_id))]
  const { data: configs } = await db
    .from('google_sheets_config')
    .select('*')
    .in('account_id', accountIds)
    .eq('status', 'connected')

  const configByAccount = new Map<string, GoogleSheetsConfigRow>()
  for (const row of (configs as GoogleSheetsConfigRow[] | null) ?? []) {
    configByAccount.set(row.account_id, row)
  }

  const tokenByAccount = new Map<string, string>()
  const budget: Budget = { remaining: opts?.maxEnrolls ?? MAX_ENROLLS_PER_POLL }

  for (const source of leadGenList) {
    if (budget.remaining <= 0) break
    result.sources_checked += 1
    const config = configByAccount.get(source.account_id)
    if (!config) {
      result.errors.push(`Source "${source.name}": Google Sheets not connected`)
      continue
    }

    try {
      let accessToken = tokenByAccount.get(source.account_id)
      if (!accessToken) {
        accessToken = await getValidAccessToken(db, config)
        tokenByAccount.set(source.account_id, accessToken)
      }
      const outcome = await processSource(db, config, source, accessToken, budget)
      result.rows_processed += outcome.rows
      result.enrolled += outcome.enrolled
      result.skipped += outcome.skipped
      if (outcome.error) result.errors.push(outcome.error)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'poll failed'
      console.error(`[leads] poll source ${source.id}:`, err)
      result.errors.push(`Source "${source.name}": ${message}`)
    }
  }

  return result
}
