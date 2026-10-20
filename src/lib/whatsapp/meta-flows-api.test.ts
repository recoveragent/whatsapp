import { afterEach, describe, expect, it, vi } from 'vitest'

import { MetaFlowsApiError, publishFormToMeta } from './meta-flows-api'

type Call = { url: string; method: string; body: unknown }

function mockMeta(routes: Array<[RegExp, string, unknown, number?]>) {
  const calls: Call[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET'
      calls.push({ url, method, body: init.body })
      const hit = routes.find(([re, m]) => m === method && re.test(url))
      if (!hit) throw new Error(`unexpected ${method} ${url}`)
      return new Response(JSON.stringify(hit[2]), { status: hit[3] ?? 200 })
    }),
  )
  return calls
}

const base = {
  wabaId: '111',
  accessToken: 'tok',
  name: 'Lead form',
  categories: ['LEAD_GENERATION'],
  flowJson: { version: '7.3', screens: [] },
}

afterEach(() => vi.unstubAllGlobals())

describe('publishFormToMeta', () => {
  it('creates, uploads, validates and publishes a new Flow', async () => {
    const calls = mockMeta([
      [/\/111\/flows$/, 'POST', { id: '999' }],
      [/\/999\/assets$/, 'POST', { success: true, validation_errors: [] }],
      [/\/999\?fields=status,validation_errors$/, 'GET', { status: 'DRAFT', validation_errors: [] }],
      [/\/999\/publish$/, 'POST', { success: true }],
    ])
    const res = await publishFormToMeta({ ...base, existingFlowId: null, publish: true })
    expect(res).toEqual({ flowId: '999', status: 'PUBLISHED', created: true, validationErrors: [] })
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*v\d+\.\d+/, '')}`)).toEqual([
      'POST /111/flows',
      'POST /999/assets',
      'GET /999?fields=status,validation_errors',
      'POST /999/publish',
    ])
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ name: 'Lead form', categories: ['LEAD_GENERATION'] })
    const upload = calls[1]!.body as FormData
    expect(upload.get('asset_type')).toBe('FLOW_JSON')
    expect(await (upload.get('file') as Blob).text()).toBe(JSON.stringify(base.flowJson))
  })

  it('re-uploads into an existing DRAFT Flow instead of creating one', async () => {
    const calls = mockMeta([
      [/\/555\?fields/, 'GET', { status: 'DRAFT', validation_errors: [] }],
      [/\/555\/assets$/, 'POST', { success: true }],
    ])
    const res = await publishFormToMeta({ ...base, existingFlowId: '555', publish: false })
    expect(res).toEqual({ flowId: '555', status: 'DRAFT', created: false, validationErrors: [] })
    expect(calls.some((c) => /\/flows$/.test(c.url) || /publish/.test(c.url))).toBe(false)
  })

  it('creates a new Flow when the existing one is already published', async () => {
    mockMeta([
      [/\/555\?fields/, 'GET', { status: 'PUBLISHED', validation_errors: [] }],
      [/\/111\/flows$/, 'POST', { id: '777' }],
      [/\/777\/assets$/, 'POST', { success: true }],
      [/\/777\?fields/, 'GET', { status: 'DRAFT' }],
      [/\/777\/publish$/, 'POST', { success: true }],
    ])
    const res = await publishFormToMeta({ ...base, existingFlowId: '555', publish: true })
    expect(res).toMatchObject({ flowId: '777', created: true, status: 'PUBLISHED' })
  })

  it('stops before publishing when Meta reports validation errors', async () => {
    const errors = [{ error: 'INVALID_PROPERTY', message: 'Invalid property "x"' }]
    const calls = mockMeta([
      [/\/111\/flows$/, 'POST', { id: '999' }],
      [/\/999\/assets$/, 'POST', { success: true, validation_errors: errors }],
      [/\/999\?fields/, 'GET', { status: 'DRAFT', validation_errors: errors }],
    ])
    const res = await publishFormToMeta({ ...base, existingFlowId: null, publish: true })
    expect(res.validationErrors).toEqual(errors)
    expect(calls.some((c) => /publish/.test(c.url))).toBe(false)
  })

  it('flags missing whatsapp_business_management permission', async () => {
    mockMeta([
      [/\/111\/flows$/, 'POST', { error: { code: 200, message: '(#200) Requires whatsapp_business_management permission' } }, 403],
    ])
    const err = await publishFormToMeta({ ...base, existingFlowId: null, publish: true }).catch((e) => e)
    expect(err).toBeInstanceOf(MetaFlowsApiError)
    expect(err.permission).toBe(true)
    expect(err.message).toMatch(/whatsapp_business_management/)
    expect(err.message).toMatch(/Reconnect WhatsApp/)
  })
})
