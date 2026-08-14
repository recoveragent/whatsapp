import { describe, expect, it } from 'vitest'

import {
  templateVariableGroupsForFlow,
  webhookTemplateVariableOptions,
} from './template-variables'

describe('webhookTemplateVariableOptions', () => {
  it('lists mapped vars and unmapped scalar payload paths', () => {
    const options = webhookTemplateVariableOptions({
      variable_mappings: {
        time: 'payload.startTime',
        url: 'payload.metadata.videoCallUrl',
      },
      last_received_payload: {
        payload: {
          startTime: '2026-08-14T04:30:00.000Z',
          metadata: { videoCallUrl: 'https://meet.example.com/abc' },
          attendees: [{ name: 'Jane' }],
        },
      },
    })

    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: 'time (payload.startTime)',
          token: '{{ vars.time }}',
        }),
        expect.objectContaining({
          label: 'url (payload.metadata.videoCallUrl)',
          token: '{{ vars.url }}',
        }),
        expect.objectContaining({
          label: 'payload.attendees.0.name',
          token: '{{ trigger.payload.attendees.0.name }}',
        }),
      ]),
    )
    expect(
      options.some((o) => o.token === '{{ trigger.payload.startTime }}'),
    ).toBe(false)
  })

  it('falls back to a generic webhook field when nothing is configured', () => {
    expect(webhookTemplateVariableOptions()).toEqual([
      expect.objectContaining({ label: 'Webhook field (any path)' }),
    ])
  })

  it('always includes generic webhook field when payload options exist', () => {
    const options = webhookTemplateVariableOptions({
      variable_mappings: { time: 'payload.startTime' },
      last_received_payload: { payload: { startTime: '2026-08-14T04:30:00.000Z' } },
    })
    expect(options.some((o) => o.token === '{{ trigger.field_name }}')).toBe(true)
  })
})

describe('templateVariableGroupsForFlow', () => {
  it('includes fallback presets', () => {
    const groups = templateVariableGroupsForFlow('first_inbound_message')
    const fallback = groups.find((g) => g.id === 'fallback')
    expect(fallback?.options.some((o) => o.token.includes('|'))).toBe(true)
  })

  it('includes webhook trigger attributes from config', () => {
    const groups = templateVariableGroupsForFlow('webhook_received', {
      variable_mappings: { meeting_time: 'payload.startTime' },
    })
    const trigger = groups.find((g) => g.id === 'trigger')
    expect(trigger?.options.some((o) => o.token === '{{ vars.meeting_time }}')).toBe(
      true,
    )
  })
})
