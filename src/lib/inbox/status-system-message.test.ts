import { describe, expect, it } from 'vitest'

import { formatConversationStatusCopy } from './status-system-message'

describe('formatConversationStatusCopy', () => {
  it('names the agent for open/closed/follow-up', () => {
    expect(
      formatConversationStatusCopy('closed', {
        kind: 'agent',
        name: 'Priya',
        userId: 'u1',
      }),
    ).toBe('Chat closed by Priya')
    expect(
      formatConversationStatusCopy('open', {
        kind: 'agent',
        name: 'Priya',
        userId: 'u1',
      }),
    ).toBe('Chat opened by Priya')
    expect(
      formatConversationStatusCopy('followup', {
        kind: 'agent',
        name: 'Priya',
        userId: 'u1',
      }),
    ).toBe('Marked for follow-up by Priya')
  })

  it('describes customer reopen and automation/flow closes', () => {
    expect(
      formatConversationStatusCopy('open', { kind: 'customer' }),
    ).toBe('Chat opened · customer replied')
    expect(
      formatConversationStatusCopy('closed', { kind: 'automation' }),
    ).toBe('Chat closed by automation')
    expect(
      formatConversationStatusCopy('closed', { kind: 'flow' }),
    ).toBe('Chat closed by flow')
  })
})
