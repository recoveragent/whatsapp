import { describe, expect, it } from 'vitest'

import { normalizeWebhookToken } from './webhook-lookup'

describe('normalizeWebhookToken', () => {
  it('trims and decodes a raw token', () => {
    expect(normalizeWebhookToken('  whk_abc123  ')).toBe('whk_abc123')
  })

  it('extracts token from a pasted full URL', () => {
    expect(
      normalizeWebhookToken(
        'https://app.example.com/api/automations/webhook/whk_deadbeef',
      ),
    ).toBe('whk_deadbeef')
  })
})
