import { describe, expect, it } from 'vitest'
import { formatMetaErrorMessage } from './meta-api'

describe('formatMetaErrorMessage', () => {
  it('maps template subcode 2388299 to a clear message (no code toast)', () => {
    expect(
      formatMetaErrorMessage({
        message: '(#100) Invalid parameter',
        code: 100,
        error_subcode: 2388299,
      }),
    ).toBe(
      'Variables cannot start or end the body/header — add static text around them (e.g. "Meeting link: {{1}}.").',
    )
  })

  it('prefers Meta error_user_msg over the generic Invalid parameter', () => {
    expect(
      formatMetaErrorMessage({
        message: '(#100) Invalid parameter',
        code: 100,
        error_subcode: 2388299,
        error_user_msg: 'Please add text after the last variable.',
      }),
    ).toBe('Please add text after the last variable.')
  })

  it('prefers error_data.details when present', () => {
    expect(
      formatMetaErrorMessage({
        message: '(#100) Invalid parameter',
        code: 100,
        error_data: { details: 'body_text length exceeds limit' },
      }),
    ).toBe('body_text length exceeds limit')
  })

  it('falls back to message + code when nothing specific is available', () => {
    expect(
      formatMetaErrorMessage({
        message: '(#100) Invalid parameter',
        code: 100,
        error_subcode: 9999999,
      }),
    ).toBe('Invalid parameter (code 100/9999999)')
  })
})
