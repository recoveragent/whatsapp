import { describe, expect, it } from 'vitest'

import { interpolateFlowVars } from './extended-nodes'

describe('interpolateFlowVars', () => {
  const vars = {
    name: 'Tarun Singh',
    'payload.startTime': '17 Aug 2026, 4:00 pm',
  }

  it('resolves {{ vars.name }}', () => {
    expect(interpolateFlowVars('Hi {{ vars.name }}', vars)).toBe('Hi Tarun Singh')
  })

  it('resolves bare {{name}} shorthand', () => {
    expect(interpolateFlowVars('Hi {{name}}', vars)).toBe('Hi Tarun Singh')
  })

  it('resolves {{ trigger.path }} from dot-path vars', () => {
    expect(interpolateFlowVars('At {{ trigger.payload.startTime }}', vars)).toBe(
      'At 17 Aug 2026, 4:00 pm',
    )
  })

  it('leaves unknown bare placeholders unchanged', () => {
    expect(interpolateFlowVars('Hi {{unknown}}', vars)).toBe('Hi {{unknown}}')
  })

  it('returns empty for missing prefixed vars', () => {
    expect(interpolateFlowVars('Hi {{ vars.missing }}', vars)).toBe('Hi ')
  })
})
