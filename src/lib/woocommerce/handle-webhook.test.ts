import { describe, expect, it, vi, beforeEach } from 'vitest'

const { dispatch, sync } = vi.hoisted(() => ({ dispatch: vi.fn(), sync: vi.fn() }))
vi.mock('./sync-order', () => ({ syncWooCommerceOrder: sync }))
vi.mock('./sync-customer', () => ({ syncWooCommerceCustomer: vi.fn() }))
vi.mock('@/lib/flows/woocommerce-dispatch', () => ({ dispatchWooCommerceFlows: dispatch }))
import { handleWooCommerceWebhook } from './handle-webhook'

const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_id: 'a', user_id: 'u', store_url: 'https://store.example', status: 'connected' } }) }) }) }) } as never
const outcome = { ok: true, dispatch: { started: [], skipped: [] } }

describe('WooCommerce prepaid payment updates', () => {
  beforeEach(() => { vi.clearAllMocks(); dispatch.mockResolvedValue(outcome) })
  const deliver = (topic: string, payload: object) => handleWooCommerceWebhook({ db, storeUrl: 'https://store.example', topic, payload })
  it('reconsiders order-placed prepaid flows on confirmation and keeps the normal update', async () => {
    await deliver('order.updated', { id: 123, status: 'processing', payment_method: 'cashfree', date_paid: '2026-11-15T10:00:00' })
    expect(dispatch).toHaveBeenCalledTimes(2)
    expect(dispatch).toHaveBeenNthCalledWith(1, expect.objectContaining({ triggerType: 'woocommerce_order_updated' }))
    expect(dispatch).toHaveBeenNthCalledWith(2, expect.objectContaining({ triggerType: 'woocommerce_order_placed', prepaidUpdate: true, context: expect.objectContaining({ paymentType: 'prepaid' }) }))
  })
  it.each([
    { status: 'pending', payment_method: 'cashfree' },
    { status: 'processing', payment_method: 'cod', date_paid: '2026-11-15' },
    { status: 'cancelled', payment_method: 'cashfree', date_paid: '2026-11-15' },
  ])('does not dispatch prepaid confirmation for $status $payment_method', async (order) => {
    await deliver('order.updated', { id: 123, ...order })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch the update path for order creation', async () => {
    await deliver('order.created', { id: 123, status: 'processing', payment_method: 'cashfree', date_paid: '2026-11-15' })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ triggerType: 'woocommerce_order_placed' }))
  })
})
