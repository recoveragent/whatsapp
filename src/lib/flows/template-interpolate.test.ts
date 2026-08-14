import { describe, expect, it } from 'vitest'

import { interpolateTemplateString } from './template-interpolate'

describe('interpolateTemplateString', () => {
  const vars = {
    name: 'Tarun Singh',
    first_name: '',
    email: 'a@example.com',
  }

  it('uses fallback when prefixed var is empty', () => {
    expect(interpolateTemplateString('Hi {{ vars.first_name | "there" }}', vars)).toBe(
      'Hi there',
    )
  })

  it('prefers value over fallback when present', () => {
    expect(interpolateTemplateString('Hi {{ vars.name | "there" }}', vars)).toBe(
      'Hi Tarun Singh',
    )
  })

  it('supports single-quoted fallback', () => {
    expect(interpolateTemplateString("Hi {{ vars.first_name | 'friend' }}", vars)).toBe(
      'Hi friend',
    )
  })

  it('still resolves plain placeholders', () => {
    expect(interpolateTemplateString('Hi {{ vars.name }}', vars)).toBe('Hi Tarun Singh')
  })
})
