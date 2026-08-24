import { describe, expect, it } from 'vitest'

import { mergeMetaAttribution } from './attribution'

describe('mergeMetaAttribution', () => {
  it('keeps existing CTWA fields and adds sheet fields', () => {
    const merged = mergeMetaAttribution(
      { ctwa_clid: 'abc', attribution_source: 'ctwa' },
      {
        meta_lead_id: '1234567890123456',
        ad_id: '99',
        attribution_source: 'instant_form',
      },
    )

    expect(merged.ctwa_clid).toBe('abc')
    expect(merged.meta_lead_id).toBe('1234567890123456')
    expect(merged.ad_id).toBe('99')
    expect(merged.attribution_source).toBe('ctwa')
  })

  it('does not overwrite populated fields', () => {
    const merged = mergeMetaAttribution(
      { meta_lead_id: '1111111111111111' },
      { meta_lead_id: '2222222222222222' },
    )

    expect(merged.meta_lead_id).toBe('1111111111111111')
  })
})
