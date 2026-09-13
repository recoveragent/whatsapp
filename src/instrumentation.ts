export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { maybeStartInternalAutomationCron } = await import(
      '@/lib/automations/internal-cron'
    )
    maybeStartInternalAutomationCron()
  }
}
