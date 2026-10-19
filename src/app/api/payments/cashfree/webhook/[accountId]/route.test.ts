import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import { POST } from './route';

const h = vi.hoisted(() => ({ credentials: vi.fn(), reconcile: vi.fn(), resume: vi.fn(), filters: [] as unknown[][], row: null as Record<string, unknown> | null }));
vi.mock('@/lib/payments/collect-payment', () => ({ cashfreeCredentials: h.credentials, reconcilePayment: h.reconcile }));
vi.mock('@/lib/flows/engine', () => ({ resumeFlowPendingExecutions: h.resume }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({ from: () => {
  const query = { select: () => query, eq: (...args: unknown[]) => { h.filters.push(args); return query; }, maybeSingle: async () => ({ data: h.row, error: null }) };
  return query;
} }) }));

const accountId = '00000000-0000-4000-8000-000000000001';
function request(body: unknown, valid = true) {
  const raw = JSON.stringify(body);
  const timestamp = '1792400000000';
  const signature = createHmac('sha256', valid ? 'secret' : 'wrong').update(timestamp + raw).digest('base64');
  return new Request('https://crm.test/webhook', { method: 'POST', body: raw, headers: { 'x-webhook-signature': signature, 'x-webhook-timestamp': timestamp } });
}
const params = { params: Promise.resolve({ accountId }) };
beforeEach(() => {
  vi.clearAllMocks();
  h.filters = [];
  h.row = { flow_run_id: 'run' };
  h.credentials.mockResolvedValue({ client_secret: 'secret' });
  h.reconcile.mockResolvedValue({});
});
describe('Cashfree payment link webhook', () => {
  it('rejects forged events before querying or resolving a collection', async () => {
    expect((await POST(request({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'link' } }, false), params)).status).toBe(401);
    expect(h.filters).toEqual([]);
    expect(h.reconcile).not.toHaveBeenCalled();
  });
  it('scopes signed events to the brand, provider and pending link, and rechecks through the API', async () => {
    expect((await POST(request({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'link', link_status: 'PAID' } }), params)).status).toBe(200);
    expect(h.filters).toEqual([['account_id', accountId], ['config->>provider', 'cashfree'], ['provider_link_id', 'link'], ['status', 'pending']]);
    expect(h.reconcile).toHaveBeenCalled();
    expect(h.resume).toHaveBeenCalledWith('run');
  });
  it('acknowledges duplicate or unrelated links without sending another receipt', async () => {
    h.row = null;
    expect((await POST(request({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'link' } }), params)).status).toBe(200);
    expect(h.reconcile).not.toHaveBeenCalled();
    expect(h.resume).not.toHaveBeenCalled();
  });
  it('requests a retry if API verification fails', async () => {
    h.reconcile.mockRejectedValue(new Error('API unavailable'));
    expect((await POST(request({ type: 'PAYMENT_LINK_EVENT', data: { link_id: 'link' } }), params)).status).toBe(503);
    expect(h.resume).not.toHaveBeenCalled();
  });
});
