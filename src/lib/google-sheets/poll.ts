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

export interface PollResult {
  flows_checked: number
  rows_processed: number
  flows_started: number
  errors: string[]
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

async function processOneSource(
  db: SupabaseClient,
  flow: FlowRow,
  accessToken: string,
  cfg: GoogleSheetRowTriggerConfig,
  sourceIndex: number,
): Promise<{ rows: number; started: number; error?: string; cfg: GoogleSheetRowTriggerConfig }> {
  const source = cfg.sources[sourceIndex]
  if (!source) {
    return { rows: 0, started: 0, cfg }
  }

  const label = source.label?.trim() || source.sheet_name || source.id.slice(0, 8)

  if (!source.spreadsheet_id || !source.sheet_name || !source.phone_column) {
    return {
      rows: 0,
      started: 0,
      error: `Flow ${flow.id} source "${label}": incomplete sheet config`,
      cfg,
    }
  }

  const lastRow = await getLastRowIndex(
    accessToken,
    source.spreadsheet_id,
    source.sheet_name,
  )

  const patchSource = (patch: Partial<GoogleSheetSource>): GoogleSheetRowTriggerConfig => ({
    sources: cfg.sources.map((s, i) =>
      i === sourceIndex ? { ...s, ...patch } : s,
    ),
  })

  if (lastRow <= 1) {
    if (source.last_processed_row == null) {
      const next = patchSource({ last_processed_row: 1 })
      await updateFlowSources(db, flow, next)
      return { rows: 0, started: 0, cfg: next }
    }
    return { rows: 0, started: 0, cfg }
  }

  let watermark = source.last_processed_row
  if (watermark == null) {
    if (source.sync_existing) {
      watermark = 1
    } else {
      const next = patchSource({ last_processed_row: lastRow })
      await updateFlowSources(db, flow, next)
      return { rows: 0, started: 0, cfg: next }
    }
  }

  if (watermark >= lastRow) {
    return { rows: 0, started: 0, cfg }
  }

  const startRow = watermark + 1
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
      started: 0,
      error: `Flow ${flow.id} source "${label}": empty header row`,
      cfg,
    }
  }

  const endCol = columnLetter(Math.max(headers.length - 1, 0))
  const dataRange = `${quoteSheetName(source.sheet_name)}!A${startRow}:${endCol}${lastRow}`
  const dataRows = await fetchSheetValues(
    accessToken,
    source.spreadsheet_id,
    dataRange,
  )

  let started = 0
  let processedThrough = watermark

  for (let i = 0; i < dataRows.length; i++) {
    const absoluteRow = startRow + i
    const rowObj = rowToObject(headers, dataRows[i] ?? [])
    const phoneRaw = (rowObj[source.phone_column] ?? '').trim()

    processedThrough = absoluteRow

    if (!phoneRaw) continue

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
      continue
    }

    const vars = buildVarsFromRow(rowObj, source)
    vars.phone = contact.phone
    if (name) vars.name = name
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
    started += outcome.started.length
  }

  const next = patchSource({ last_processed_row: processedThrough })
  await updateFlowSources(db, flow, next)

  return { rows: dataRows.length, started, cfg: next }
}

async function processFlowSheets(
  db: SupabaseClient,
  _config: GoogleSheetsConfigRow,
  flow: FlowRow,
  accessToken: string,
): Promise<{ rows: number; started: number; errors: string[] }> {
  let cfg = ensureGoogleSheetRowConfig(
    flow.trigger_config as Record<string, unknown>,
  )

  let rows = 0
  let started = 0
  const errors: string[] = []

  for (let i = 0; i < cfg.sources.length; i++) {
    try {
      const outcome = await processOneSource(db, flow, accessToken, cfg, i)
      cfg = outcome.cfg
      rows += outcome.rows
      started += outcome.started
      if (outcome.error) errors.push(outcome.error)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'source poll failed'
      const src = cfg.sources[i]
      const label = src?.label?.trim() || src?.sheet_name || String(i + 1)
      console.error(`[google-sheets] poll flow ${flow.id} source ${label}:`, err)
      errors.push(`Flow ${flow.id} source "${label}": ${message}`)
    }
  }

  return { rows, started, errors }
}

/**
 * Poll all active google_sheet_row flows for connected accounts.
 */
export async function pollGoogleSheetFlows(db: SupabaseClient): Promise<PollResult> {
  const result: PollResult = {
    flows_checked: 0,
    rows_processed: 0,
    flows_started: 0,
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

  for (const flow of list) {
    result.flows_checked += 1
    const config = configByAccount.get(flow.account_id)
    if (!config) {
      result.errors.push(`Flow ${flow.id}: Google Sheets not connected`)
      continue
    }

    try {
      const accessToken = await getValidAccessToken(db, config)
      const outcome = await processFlowSheets(db, config, flow, accessToken)
      result.rows_processed += outcome.rows
      result.flows_started += outcome.started
      result.errors.push(...outcome.errors)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'poll failed'
      console.error(`[google-sheets] poll flow ${flow.id}:`, err)
      result.errors.push(`Flow ${flow.id}: ${message}`)
    }
  }

  return result
}
