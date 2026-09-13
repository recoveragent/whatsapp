import { supabaseAdmin } from '@/lib/automations/admin-client'
import { resumePendingExecution } from '@/lib/automations/engine'
import type { AutomationContext } from '@/lib/automations/engine'
import { pollGoogleSheetFlows } from '@/lib/google-sheets/poll'
import { resumeFlowPendingExecutions } from '@/lib/flows/engine'
import { processDueCadences } from '@/lib/leads/engine'
import { pollLeadSources } from '@/lib/leads/poll-sources'
import { processDueAbandonedCheckouts } from '@/lib/shopify/handle-webhook'

export interface ScheduledAutomationJobsResult {
  processed: number
  google_sheets: unknown
  lead_sheets: unknown
  cadences: unknown
  flow_waits: unknown
  abandoned_checkouts: number
  errors: string[]
}

function settledValue<T>(
  result: PromiseSettledResult<T>,
  label: string,
  errors: string[],
): T | null {
  if (result.status === 'fulfilled') return result.value
  const message =
    result.reason instanceof Error
      ? result.reason.message
      : String(result.reason)
  errors.push(`${label}: ${message}`)
  console.error(`[automations-cron] ${label} failed:`, result.reason)
  return null
}

/**
 * Drain automation waits, sheet polls, cadences, flow waits, and the
 * abandoned-checkout queue. Shared by the HTTP cron route and the
 * in-process fallback scheduler on long-lived Node hosts.
 */
export async function runScheduledAutomationJobs(): Promise<ScheduledAutomationJobsResult> {
  const admin = supabaseAdmin()
  const errors: string[] = []

  const { data: due, error } = await admin
    .from('automation_pending_executions')
    .select('*')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(50)

  if (error) {
    throw new Error(error.message)
  }

  let processed = 0
  for (const row of due ?? []) {
    const { data: claim } = await admin
      .from('automation_pending_executions')
      .update({ status: 'running' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle()
    if (!claim) continue

    await resumePendingExecution({
      id: row.id as string,
      automation_id: row.automation_id as string,
      account_id: row.account_id as string,
      user_id: row.user_id as string,
      contact_id: (row.contact_id as string | null) ?? null,
      log_id: (row.log_id as string | null) ?? null,
      parent_step_id: (row.parent_step_id as string | null) ?? null,
      branch: (row.branch as 'yes' | 'no' | null) ?? null,
      next_step_position: row.next_step_position as number,
      context: (row.context as AutomationContext) ?? {},
    })
    processed++
  }

  const [
    googleSheetsResult,
    leadSheetsResult,
    cadencesResult,
    flowWaitsResult,
    abandonedCheckoutsResult,
  ] = await Promise.allSettled([
    pollGoogleSheetFlows(admin),
    pollLeadSources(admin),
    processDueCadences(admin),
    resumeFlowPendingExecutions(),
    processDueAbandonedCheckouts(admin),
  ])

  return {
    processed,
    google_sheets: settledValue(googleSheetsResult, 'google_sheets', errors),
    lead_sheets: settledValue(leadSheetsResult, 'lead_sheets', errors),
    cadences: settledValue(cadencesResult, 'cadences', errors),
    flow_waits: settledValue(flowWaitsResult, 'flow_waits', errors),
    abandoned_checkouts:
      settledValue(abandonedCheckoutsResult, 'abandoned_checkouts', errors) ??
      0,
    errors,
  }
}
