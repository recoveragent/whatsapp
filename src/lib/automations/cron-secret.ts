import { timingSafeEqual } from 'node:crypto'

/**
 * Validate the shared cron secret. Trims whitespace on both sides so a
 * trailing newline in hPanel's cron command doesn't cause silent 401s.
 */
export function isValidAutomationCronSecret(suppliedRaw: string | null): boolean {
  const expected = process.env.AUTOMATION_CRON_SECRET?.trim()
  if (!expected) return false

  const supplied = (suppliedRaw ?? '').trim()
  const suppliedBuf = Buffer.from(supplied)
  const expectedBuf = Buffer.from(expected)
  if (suppliedBuf.length !== expectedBuf.length) return false
  return timingSafeEqual(suppliedBuf, expectedBuf)
}
