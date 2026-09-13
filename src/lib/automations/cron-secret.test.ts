import { afterEach, describe, expect, it } from 'vitest'

import { isValidAutomationCronSecret } from './cron-secret'

describe('isValidAutomationCronSecret', () => {
  afterEach(() => {
    delete process.env.AUTOMATION_CRON_SECRET
  })

  it('accepts a trimmed match when the header has trailing whitespace', () => {
    process.env.AUTOMATION_CRON_SECRET = 'abc123'
    expect(isValidAutomationCronSecret('abc123\n')).toBe(true)
  })

  it('rejects a wrong secret', () => {
    process.env.AUTOMATION_CRON_SECRET = 'abc123'
    expect(isValidAutomationCronSecret('wrong')).toBe(false)
  })
})
