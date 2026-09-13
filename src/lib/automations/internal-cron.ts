import { runScheduledAutomationJobs } from '@/lib/automations/run-scheduled-jobs'

const DEFAULT_INTERVAL_MS = 60_000

let started = false

/**
 * On long-lived Node hosts (Hostinger Managed Node, Docker) start an
 * in-process scheduler so abandoned-checkout mirrors and automation
 * waits drain even when hPanel cron is missing or has a stale secret.
 *
 * Skipped on Vercel/serverless (VERCEL is set) where an external pinger
 * is expected. Set DISABLE_INTERNAL_AUTOMATION_CRON=1 to opt out.
 */
export function maybeStartInternalAutomationCron(): void {
  if (started) return
  if (process.env.DISABLE_INTERNAL_AUTOMATION_CRON === '1') return
  if (process.env.NODE_ENV !== 'production') return
  if (!process.env.AUTOMATION_CRON_SECRET?.trim()) return
  if (process.env.VERCEL) return

  started = true

  const parsed = Number.parseInt(
    process.env.INTERNAL_AUTOMATION_CRON_INTERVAL_MS ?? '',
    10,
  )
  const intervalMs =
    Number.isFinite(parsed) && parsed >= 15_000 ? parsed : DEFAULT_INTERVAL_MS

  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      await runScheduledAutomationJobs()
    } catch (err) {
      console.error('[internal-automation-cron] tick failed:', err)
    } finally {
      running = false
    }
  }

  setTimeout(() => void tick(), 5_000)
  setInterval(() => void tick(), intervalMs)

  console.info('[internal-automation-cron] started', { intervalMs })
}
