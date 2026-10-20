import { describe, expect, it } from 'vitest'
import { summarizeFlowJson } from './flow-json'

describe('summarizeFlowJson', () => {
  it('finds the entry screen and the complete-payload keys with labels', () => {
    const json = {
      version: '6.0',
      screens: [
        {
          id: 'SUPPORT',
          terminal: true,
          layout: {
            type: 'SingleColumnLayout',
            children: [
              {
                type: 'Form',
                name: 'f',
                children: [
                  { type: 'RadioButtonsGroup', name: 'topic', label: 'Support for' },
                  {
                    type: 'Footer',
                    label: 'Submit',
                    'on-click-action': {
                      name: 'complete',
                      payload: { name: '${data.name}', dob: '${data.dob}', topic: '${form.topic}' },
                    },
                  },
                ],
              },
            ],
          },
        },
        {
          id: 'DETAILS',
          layout: {
            children: [
              { type: 'TextInput', name: 'name', label: 'Your name' },
              { type: 'DatePicker', name: 'dob', label: 'Date of birth' },
              {
                type: 'Footer',
                'on-click-action': { name: 'navigate', next: { type: 'screen', name: 'SUPPORT' } },
              },
            ],
          },
        },
      ],
    }
    expect(summarizeFlowJson(json)).toEqual({
      entry_screen: 'DETAILS',
      screen_ids: ['SUPPORT', 'DETAILS'],
      fields: [
        { key: 'name', label: 'Your name' },
        { key: 'dob', label: 'Date of birth' },
        { key: 'topic', label: 'Support for' },
      ],
    })
  })

  it('falls back to input names and tolerates junk', () => {
    expect(summarizeFlowJson(null)).toEqual({ entry_screen: null, screen_ids: [], fields: [] })
    expect(
      summarizeFlowJson({ screens: [{ id: 'A', layout: { children: [{ type: 'TextInput', name: 'email' }] } }] }).fields,
    ).toEqual([{ key: 'email' }])
  })
})
