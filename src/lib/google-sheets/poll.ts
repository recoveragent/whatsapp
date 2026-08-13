import type { SupabaseClient } from '@supabase/supabase-js'

import { ensureConversation, ensureShopifyContact } from '@/lib/shopify/ensure-contact'
import { runFlowsForTrigger } from '@/lib/flows/dispatch-external'
import type { FlowRow } from '@/lib/flows/types'
import {
  ensureGoogleSheetRowConfig,
  type GoogleSheetRowTriggerConfig,
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

async function updateFlowWatermark(
  db: SupabaseClient,
  flow: FlowRow,
  cfg: GoogleSheetRowTriggerConfig,
  lastProcessedRow: number,
): Promise<void> {
  const next = {
    ...cfg,
    last_processed_row: lastProcessedRow,
  }
  await db
    .from('flows')
    .update({ trigger_config: next })
    .eq('id', flow.id)
}

function buildVarsFromRow(
  row: Record<string, string>,
  cfg: GoogleSheetRowTriggerConfig,
): Record<string, unknown> {
  const vars: Record<string, unknown> = { ...row }
  const mappings = cfg.variable_mappings ?? {}
  for (const [varName, column] of Object.entries(mappings)) {
    if (!varName.trim() || !column.trim()) continue
    vars[varName.trim()] = row[column] ?? ''
  }
  return vars
}

async function processFlowSheet(
  db: SupabaseClient,
  config: GoogleSheetsConfigRow,
  flow: FlowRow,
  accessToken: string,
): Promise<{ rows: number; started: number; error?: string }> {
  const cfg = ensureGoogleSheetRowConfig(
    flow.trigger_config as Record<string, unknown>,
  )

  if (!cfg.spreadsheet_id || !cfg.sheet_name || !cfg.phone_column) {
    return { rows: 0, started: 0, error: `Flow ${flow.id}: incomplete sheet config` }
  }

  const lastRow = await getLastRowIndex(
    accessToken,
    cfg.spreadsheet_id,
    cfg.sheet_name,
  )

  // No data beyond header
  if (lastRow <= 1) {
    if (cfg.last_processed_row == null) {
      await updateFlowWatermark(db, flow, cfg, 1)
    }
    return { rows: 0, started: 0 }
  }

  let watermark = cfg.last_processed_row
  if (watermark == null) {
    if (cfg.sync_existing) {
      watermark = 1
    } else {
      await updateFlowWatermark(db, flow, cfg, lastRow)
      return { rows: 0, started: 0 }
    }
  }

  if (watermark >= lastRow) {
    return { rows: 0, started: 0 }
  }

  const startRow = watermark + 1
  const headerRange = `${quoteSheetName(cfg.sheet_name)}!1:1`
  const headerRows = await fetchSheetValues(
    accessToken,
    cfg.spreadsheet_id,
    headerRange,
  )
  const headers = (headerRows[0] ?? []).map((h) => h.trim())
  if (headers.length === 0) {
    return { rows: 0, started: 0, error: `Flow ${flow.id}: empty header row` }
  }

  const endCol = columnLetter(Math.max(headers.length - 1, 0))
  const dataRange = `${quoteSheetName(cfg.sheet_name)}!A${startRow}:${endCol}${lastRow}`
  const dataRows = await fetchSheetValues(
    accessToken,
    cfg.spreadsheet_id,
    dataRange,
  )

  let started = 0
  let processedThrough = watermark

  for (let i = 0; i < dataRows.length; i++) {
    const absoluteRow = startRow + i
    const rowObj = rowToObject(headers, dataRows[i] ?? [])
    const phoneRaw = (rowObj[cfg.phone_column] ?? '').trim()

    processedThrough = absoluteRow

    if (!phoneRaw) continue

    const nameCol = cfg.name_column?.trim()
    const name = nameCol ? (rowObj[nameCol] ?? '').trim() : ''
    const emailCol = cfg.email_column?.trim()
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
        `[google-sheets] skip row ${absoluteRow}: could not resolve contact (phone=${phoneRaw})`,
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
      console.warn(`[google-sheets] skip row ${absoluteRow}: no conversation`)
      continue
    }

    const vars = buildVarsFromRow(rowObj, cfg)
    vars.phone = contact.phone
    if (name) vars.name = name
    if (email) vars.email = email
    vars.sheet_row = absoluteRow

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

  await updateFlowWatermark(db, flow, cfg, processedThrough)

  return { rows: dataRows.length, started }
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
      const outcome = await processFlowSheet(db, config, flow, accessToken)
      result.rows_processed += outcome.rows
      result.flows_started += outcome.started
      if (outcome.error) result.errors.push(outcome.error)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'poll failed'
      console.error(`[google-sheets] poll flow ${flow.id}:`, err)
      result.errors.push(`Flow ${flow.id}: ${message}`)
    }
  }

  return result
}
