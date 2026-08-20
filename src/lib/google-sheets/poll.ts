import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureConversation, ensureShopifyContact } from '@/lib/shopify/ensure-contact'
import { runFlowsForTrigger } from '@/lib/flows/dispatch-external'
import type { FlowRow } from '@/lib/flows/types'
import {
  ensureGoogleSheetRowConfig,
  type GoogleSheetRowTriggerConfig,
  type GoogleSheetSource,
} from './trigger-config'
import {
  columnLetter,
  fetchSheetValues,
  getLastRowIndex,
  getValidAccessToken,
  rowToObject,
  type GoogleSheetsConfigRow,
} from './sheets-client'
import { quoteSheetName } from './parse-sheet-url'
import {
  columnLetters,
  detectHeaderRow,
  guessPhoneColumn,
  looksLikePhoneCell,
  normalizeSheetPhone,
} from './sheet-columns'

/** Cap WhatsApp sends per cron tick so Hostinger/proxy timeouts cannot
 *  abort a large backlog mid-batch with the watermark uncommitted. */
export const MAX_FLOW_STARTS_PER_POLL = 8

export interface PollResult {
  flows_checked: number
  rows_processed: number
  flows_started: number
  rows_skipped: number
  errors: string[]
}

interface PollBudget {
  remainingStarts: number
}

async function updateFlowSources(
  db: SupabaseClient,
  flow: FlowRow,
  cfg: GoogleSheetRowTriggerConfig,
): Promise<void> {
  await db
    .from('flows')
    .update({ trigger_config: cfg })
    .eq('id', flow.id)
}

function buildVarsFromRow(
  row: Record<string, string>,
  source: GoogleSheetSource,
): Record<string, unknown> {
  const vars: Record<string, unknown> = { ...row }
  const mappings = source.variable_mappings ?? {}
  for (const [varName, column] of Object.entries(mappings)) {
    if (!varName.trim() || !column.trim()) continue
    vars[varName.trim()] = row[column] ?? ''
  }
  return vars
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

async function processOneSource(
  db: SupabaseClient,
  flow: FlowRow,
  accessToken: string,
  cfg: GoogleSheetRowTriggerConfig,
  sourceIndex: number,
  budget: PollBudget,
): Promise<{
  rows: number
  started: number
  skipped: number
  error?: string
  cfg: GoogleSheetRowTriggerConfig
}> {
  const source = cfg.sources[sourceIndex]
  if (!source) {
    return { rows: 0, started: 0, skipped: 0, cfg }
  }

  const label = source.label?.trim() || source.sheet_name || source.id.slice(0, 8)

  if (!source.spreadsheet_id || !source.sheet_name || !source.phone_column) {
    return {
      rows: 0,
      started: 0,
      skipped: 0,
      error: `Flow ${flow.id} source "${label}": incomplete sheet config`,
      cfg,
    }
  }

  let workingCfg = cfg
  const patchSource = (patch: Partial<GoogleSheetSource>): GoogleSheetRowTriggerConfig => {
    workingCfg = {
      sources: workingCfg.sources.map((s, i) =>
        i === sourceIndex ? { ...s, ...patch } : s,
      ),
    }
    return workingCfg
  }

  const previewRows = await fetchSheetValues(
    accessToken,
    source.spreadsheet_id,
    `${quoteSheetName(source.sheet_name)}!A1:Z20`,
  )

  const headerRow =
    typeof source.header_row === 'number' && Number.isFinite(source.header_row)
      ? Math.max(0, Math.floor(source.header_row))
      : detectHeaderRow(previewRows)

  const headerCells = headerRow > 0 ? (previewRows[headerRow - 1] ?? []) : []
  const namedHeaders = headerCells.map((h) => h.trim())
  const previewData =
    headerRow > 0 ? previewRows.slice(headerRow) : previewRows
  const letterHeaders = columnLetters(
    Math.max(
      namedHeaders.length,
      ...previewData.map((r) => r.length),
      1,
    ),
  )
  const headers = headerRow > 0 ? namedHeaders : letterHeaders
  if (headers.every((h) => !h.trim())) {
    return {
      rows: 0,
      started: 0,
      skipped: 0,
      error: `Flow ${flow.id} source "${label}": empty header row`,
      cfg,
    }
  }

  let phoneColumn = source.phone_column
  const guessed = guessPhoneColumn(headers, previewData)
  const configuredHits = previewData.filter((r) =>
    looksLikePhoneCell(rowToObject(headers, r)[phoneColumn]),
  ).length
  const guessedHits = previewData.filter((r) =>
    looksLikePhoneCell(rowToObject(headers, r)[guessed]),
  ).length
  if (configuredHits === 0 && guessedHits > 0) {
    console.warn(
      `[google-sheets] source "${label}": phone column "${phoneColumn}" has no numbers; using "${guessed}"`,
    )
    phoneColumn = guessed
    cfg = patchSource({ phone_column: guessed, header_row: headerRow })
    await updateFlowSources(db, flow, cfg)
  } else if (!headers.includes(phoneColumn) && guessedHits > 0) {
    phoneColumn = guessed
    cfg = patchSource({ phone_column: guessed, header_row: headerRow })
    await updateFlowSources(db, flow, cfg)
  } else if (!headers.includes(phoneColumn)) {
    return {
      rows: 0,
      started: 0,
      skipped: 0,
      error: `Flow ${flow.id} source "${label}": phone column "${source.phone_column}" not in header row`,
      cfg,
    }
  }

  const lastRow = await lastOccupiedRow(
    accessToken,
    source.spreadsheet_id,
    source.sheet_name,
    headers,
    phoneColumn,
  )

  const minRow = headerRow > 0 ? headerRow : 0
  if (lastRow <= minRow) {
    if (source.last_processed_row == null) {
      const next = patchSource({ last_processed_row: minRow })
      await updateFlowSources(db, flow, next)
      return { rows: 0, started: 0, skipped: 0, cfg: next }
    }
    return { rows: 0, started: 0, skipped: 0, cfg }
  }

  let watermark = source.last_processed_row
  if (watermark == null) {
    if (source.sync_existing) {
      watermark = minRow
    } else {
      const next = patchSource({ last_processed_row: lastRow })
      await updateFlowSources(db, flow, next)
      return { rows: 0, started: 0, skipped: 0, cfg: next }
    }
  }

  if (watermark >= lastRow) {
    return { rows: 0, started: 0, skipped: 0, cfg }
  }

  const startRow = watermark + 1
  const endCol = columnLetter(Math.max(headers.length - 1, 0))
  const dataRange = `${quoteSheetName(source.sheet_name)}!A${startRow}:${endCol}${lastRow}`
  const dataRows = await fetchSheetValues(
    accessToken,
    source.spreadsheet_id,
    dataRange,
  )

  const validInBatch = dataRows.filter((r) =>
    looksLikePhoneCell(rowToObject(headers, r)[phoneColumn]),
  ).length
  if (dataRows.length > 0 && validInBatch === 0) {
    return {
      rows: 0,
      started: 0,
      skipped: dataRows.length,
      error: `Flow ${flow.id} source "${label}": phone column "${phoneColumn}" has no phone numbers — pick the column that contains mobile numbers, then save`,
      cfg,
    }
  }

  let started = 0
  let skipped = 0
  let processedThrough = watermark
  let nextCfg = cfg

  for (let i = 0; i < dataRows.length; i++) {
    if (budget.remainingStarts <= 0) break

    const absoluteRow = startRow + i
    const rowObj = rowToObject(headers, dataRows[i] ?? [])
    const phoneRaw = normalizeSheetPhone(rowObj[phoneColumn] ?? '')

    const persistWatermark = async (row: number) => {
      processedThrough = row
      nextCfg = patchSource({ last_processed_row: row })
      await updateFlowSources(db, flow, nextCfg)
    }

    if (!looksLikePhoneCell(phoneRaw)) {
      skipped += 1
      await persistWatermark(absoluteRow)
      continue
    }

    const nameCol = source.name_column?.trim()
    const name = nameCol ? (rowObj[nameCol] ?? '').trim() : ''
    const emailCol = source.email_column?.trim()
    const email = emailCol ? (rowObj[emailCol] ?? '').trim() : ''

    const contact = await ensureShopifyContact(
      db,
      flow.account_id,
      flow.user_id,
      phoneRaw,
      name || phoneRaw,
    )
    if (!contact) {
      console.warn(
        `[google-sheets] skip row ${absoluteRow} (${label}): could not resolve contact`,
      )
      skipped += 1
      await persistWatermark(absoluteRow)
      continue
    }

    if (email) {
      await db
        .from('contacts')
        .update({ email, updated_at: new Date().toISOString() })
        .eq('id', contact.id)
        .eq('account_id', flow.account_id)
    }

    const conversation = await ensureConversation(
      db,
      flow.account_id,
      flow.user_id,
      contact.id,
    )
    if (!conversation) {
      console.warn(`[google-sheets] skip row ${absoluteRow} (${label}): no conversation`)
      skipped += 1
      await persistWatermark(absoluteRow)
      continue
    }

    const vars = buildVarsFromRow(rowObj, source)
    vars.phone = contact.phone
    vars.name = name || String(vars.name ?? '').trim() || 'there'
    if (email) vars.email = email
    vars.sheet_row = absoluteRow
    vars.sheet_source = label
    vars.spreadsheet_id = source.spreadsheet_id

    const outcome = await runFlowsForTrigger({
      accountId: flow.account_id,
      triggerType: 'google_sheet_row',
      contactId: contact.id,
      conversationId: conversation.id,
      flowId: flow.id,
      context: { vars },
    })

    if (outcome.no_active_flows) {
      console.warn(
        `[google-sheets] stop at row ${absoluteRow} (${label}): flow is not active`,
      )
      break
    }

    budget.remainingStarts -= 1
    started += outcome.started.length
    if (outcome.started.length === 0) {
      skipped += 1
      const reason = outcome.skipped[0]?.reason ?? 'not_started'
      console.warn(`[google-sheets] skip row ${absoluteRow} (${label}): ${reason}`)
    }
    await persistWatermark(absoluteRow)
  }

  return {
    rows: Math.max(0, processedThrough - watermark),
    started,
    skipped,
    cfg: nextCfg,
  }
}

async function processFlowSheets(
  db: SupabaseClient,
  _config: GoogleSheetsConfigRow,
  flow: FlowRow,
  accessToken: string,
  budget: PollBudget,
): Promise<{ rows: number; started: number; skipped: number; errors: string[] }> {
  let cfg = ensureGoogleSheetRowConfig(
    flow.trigger_config as Record<string, unknown>,
  )

  let rows = 0
  let started = 0
  let skipped = 0
  const errors: string[] = []

  const indexes = cfg.sources.map((_, i) => i)
  indexes.sort((a, b) => {
    const wa = cfg.sources[a]?.last_processed_row
    const wb = cfg.sources[b]?.last_processed_row
    if (wa == null && wb != null) return -1
    if (wb == null && wa != null) return 1
    return a - b
  })

  for (const i of indexes) {
    if (budget.remainingStarts <= 0) break
    try {
      const outcome = await processOneSource(
        db,
        flow,
        accessToken,
        cfg,
        i,
        budget,
      )
      cfg = outcome.cfg
      rows += outcome.rows
      started += outcome.started
      skipped += outcome.skipped
      if (outcome.error) errors.push(outcome.error)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'source poll failed'
      const src = cfg.sources[i]
      const label = src?.label?.trim() || src?.sheet_name || String(i + 1)
      console.error(`[google-sheets] poll flow ${flow.id} source ${label}:`, err)
      errors.push(`Flow ${flow.id} source "${label}": ${message}`)
    }
  }

  return { rows, started, skipped, errors }
}

/**
 * Poll all active google_sheet_row flows for connected accounts.
 */
export async function pollGoogleSheetFlows(db: SupabaseClient): Promise<PollResult> {
  const result: PollResult = {
    flows_checked: 0,
    rows_processed: 0,
    flows_started: 0,
    rows_skipped: 0,
    errors: [],
  }

  const { data: flows, error: flowsErr } = await db
    .from('flows')
    .select('*')
    .eq('status', 'active')
    .eq('trigger_type', 'google_sheet_row')

  if (flowsErr) {
    result.errors.push(flowsErr.message)
    return result
  }

  const list = (flows as FlowRow[] | null) ?? []
  if (list.length === 0) return result

  const accountIds = [...new Set(list.map((f) => f.account_id))]
  const { data: configs } = await db
    .from('google_sheets_config')
    .select('*')
    .in('account_id', accountIds)
    .eq('status', 'connected')

  const configByAccount = new Map<string, GoogleSheetsConfigRow>()
  for (const row of (configs as GoogleSheetsConfigRow[] | null) ?? []) {
    configByAccount.set(row.account_id, row)
  }

  const budget: PollBudget = { remainingStarts: MAX_FLOW_STARTS_PER_POLL }

  for (const flow of list) {
    if (budget.remainingStarts <= 0) break
    result.flows_checked += 1
    const config = configByAccount.get(flow.account_id)
    if (!config) {
      result.errors.push(`Flow ${flow.id}: Google Sheets not connected`)
      continue
    }

    try {
      const accessToken = await getValidAccessToken(db, config)
      const outcome = await processFlowSheets(db, config, flow, accessToken, budget)
      result.rows_processed += outcome.rows
      result.flows_started += outcome.started
      result.rows_skipped += outcome.skipped
      result.errors.push(...outcome.errors)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'poll failed'
      console.error(`[google-sheets] poll flow ${flow.id}:`, err)
      result.errors.push(`Flow ${flow.id}: ${message}`)
    }
  }

  return result
}
