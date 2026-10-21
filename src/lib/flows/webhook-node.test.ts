import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/webhooks/ssrf', () => ({
  isDeliverableUrl: vi.fn(async () => true),
}))

import { isDeliverableUrl } from '@/lib/webhooks/ssrf'
import { sendFlowWebhook } from './webhook-node'

describe('sendFlowWebhook', () => {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200 }))

  beforeEach(() => {
    fetchSpy.mockClear()
    vi.mocked(isDeliverableUrl).mockResolvedValue(true)
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses a private destination without calling fetch', async () => {
    vi.mocked(isDeliverableUrl).mockResolvedValue(false)
    await expect(
      sendFlowWebhook({ url: 'http://169.254.169.254/latest/meta-data/' }, {}, 'c1'),
    ).rejects.toThrow('webhook destination not allowed')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('interpolates URI-encoded vars into the URL and headers', async () => {
    await sendFlowWebhook(
      {
        url: 'https://example.com/hook?order={{ vars.order_id }}',
        headers: { Authorization: 'Bearer {{ vars.token }}', ' ': 'ignored' },
        body_template: '{"name":"{{ vars.name }}"}',
      },
      { order_id: 'A&B 1', token: 'tok', name: 'Asha' },
      'c1',
    )
    expect(isDeliverableUrl).toHaveBeenCalledWith('https://example.com/hook?order=A%26B%201')
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/hook?order=A%26B%201',
      expect.objectContaining({
        method: 'POST',
        redirect: 'manual',
        body: '{"name":"Asha"}',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer tok' },
      }),
    )
  })

  it('sends vars and contact id when no body template is set', async () => {
    await sendFlowWebhook({ url: 'https://example.com/hook' }, { a: 1 }, 'c1')
    const init = (fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[1]
    expect(JSON.parse(init.body as string)).toEqual({ vars: { a: 1 }, contact_id: 'c1' })
  })

  it('throws on a non-2xx response', async () => {
    fetchSpy.mockResolvedValueOnce({ ok: false, status: 500 })
    await expect(
      sendFlowWebhook({ url: 'https://example.com/hook' }, {}, 'c1'),
    ).rejects.toThrow('webhook returned 500')
  })
})
