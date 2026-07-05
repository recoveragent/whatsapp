import { describe, expect, it } from 'vitest'

import {
  normalizeTemplateButtons,
  quickReplyButtonsFromTemplate,
  syncTemplateButtonConfig,
} from './template-buttons'

describe('normalizeTemplateButtons', () => {
  it('parses quick_reply type variants and label fallback', () => {
    const buttons = normalizeTemplateButtons([
      { type: 'quick_reply', label: 'Yes' },
      { type: 'QUICKREPLY', text: 'No' },
    ])
    expect(buttons).toEqual([
      { type: 'QUICK_REPLY', text: 'Yes' },
      { type: 'QUICK_REPLY', text: 'No' },
    ])
  })

  it('parses JSON string payloads', () => {
    const buttons = normalizeTemplateButtons(
      JSON.stringify([{ type: 'QUICK_REPLY', text: 'Confirm' }]),
    )
    expect(buttons).toEqual([{ type: 'QUICK_REPLY', text: 'Confirm' }])
  })
})

describe('quickReplyButtonsFromTemplate', () => {
  it('maps quick replies to reply_id/title pairs', () => {
    expect(
      quickReplyButtonsFromTemplate({
        buttons: [
          { type: 'QUICK_REPLY', text: 'Address is correct' },
          { type: 'URL', text: 'Track', url: 'https://x.com' },
        ],
      }),
    ).toEqual([{ reply_id: 'Address is correct', title: 'Address is correct' }])
  })
})

describe('syncTemplateButtonConfig', () => {
  it('preserves next_node_key when template buttons unchanged', () => {
    const synced = syncTemplateButtonConfig(
      [{ reply_id: 'Yes', title: 'Yes', next_node_key: 'step_b' }],
      { buttons: [{ type: 'QUICK_REPLY', text: 'Yes' }] },
    )
    expect(synced).toEqual([
      { reply_id: 'Yes', title: 'Yes', next_node_key: 'step_b' },
    ])
  })
})
