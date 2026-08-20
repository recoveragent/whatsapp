import { describe, expect, it } from 'vitest'

import { inferLeadLanguage, pickTemplateLanguage } from './language'

describe('inferLeadLanguage', () => {
  it('maps hindi spellings to hi', () => {
    expect(inferLeadLanguage('Hindi')).toBe('hi')
    expect(inferLeadLanguage('HI')).toBe('hi')
    expect(inferLeadLanguage('हिंदी')).toBe('hi')
  })

  it('maps english to en and uses the fallback when blank', () => {
    expect(inferLeadLanguage('English', 'hi')).toBe('en')
    expect(inferLeadLanguage('', 'hi')).toBe('hi')
    expect(inferLeadLanguage('unknown', 'en')).toBe('en')
  })
})

describe('pickTemplateLanguage', () => {
  it('prefers hi* when the lead is Hindi', () => {
    expect(
      pickTemplateLanguage(
        [{ language: 'en_US' }, { language: 'hi' }],
        'hi',
      ),
    ).toBe('hi')
  })

  it('falls back to en when Hindi is missing', () => {
    expect(pickTemplateLanguage([{ language: 'en_US' }], 'hi')).toBe('en_US')
  })
})
