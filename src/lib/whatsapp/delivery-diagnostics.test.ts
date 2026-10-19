import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  recordApiAcceptance,
  recordDeliveryEvent,
  recordDeliveryStatus,
  deliveryDurations,
  type DeliveryEvent,
} from './delivery-diagnostics';
import { sendTemplateMessage } from './meta-api';

afterEach(() => vi.unstubAllGlobals());
function database() {
  const upsert = vi.fn().mockResolvedValue({ error: null });
  const eq = vi.fn();
  const query = {
    select: () => query,
    eq,
    maybeSingle: async () => ({ data: { account_id: 'brand' }, error: null }),
  };
  eq.mockReturnValue(query);
  const from = vi.fn((table: string) =>
    table === 'whatsapp_config' ? query : { upsert }
  );
  return { db: { from } as unknown as SupabaseClient, upsert, eq };
}
describe('delivery diagnostics', () => {
  it.each(['accepted', 'held_for_quality_assessment', undefined])(
    'preserves Meta acceptance/hold status %s without assuming delivery',
    async (status) => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue({
            ok: true,
            json: async () => ({
              messages: [{ id: 'wamid.test', message_status: status }],
            }),
          })
      );
      const result = await sendTemplateMessage({
        phoneNumberId: 'phone',
        accessToken: 'secret',
        to: '919999999999',
        templateName: 'payment',
      });
      expect(result.deliveryTiming).toMatchObject({
        message_status: status ?? null,
        duration_ms: expect.any(Number),
        started_at: expect.any(String),
        accepted_at: expect.any(String),
      });
    }
  );
  it('stores account and phone-scoped acceptance independently of a message row', async () => {
    const h = database();
    await recordApiAcceptance(h.db, 'brand', 'phone', 'wamid', {
      started_at: '2026-10-19T18:00:00Z',
      accepted_at: '2026-10-19T18:00:01Z',
      duration_ms: 1000,
      message_status: 'held_for_quality_assessment',
    });
    expect(h.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'brand',
        phone_number_id: 'phone',
        event_type: 'api_accepted',
        details: expect.objectContaining({
          message_status: 'held_for_quality_assessment',
        }),
      }),
      expect.objectContaining({ ignoreDuplicates: true })
    );
  });
  it('records provider event time separately from webhook arrival, including duplicates and out-of-order statuses', async () => {
    const h = database();
    for (const status of ['read', 'delivered', 'sent', 'delivered'])
      await recordDeliveryStatus(
        h.db,
        'phone',
        { id: 'wamid', status, timestamp: '1792432800' },
        '2026-10-19T18:02:00Z'
      );
    expect(h.eq).toHaveBeenCalledWith('phone_number_id', 'phone');
    expect(h.upsert).toHaveBeenCalledTimes(4);
    expect(h.upsert.mock.calls[1]).toEqual(h.upsert.mock.calls[3]);
    expect(h.upsert.mock.calls[0][0]).toMatchObject({
      account_id: 'brand',
      occurred_at: new Date(1792432800000).toISOString(),
      received_at: '2026-10-19T18:02:00Z',
    });
  });
  it('rejects invalid timestamps and unknown statuses', async () => {
    const h = database();
    await recordDeliveryStatus(h.db, 'phone', {
      id: 'wamid',
      status: 'unknown',
      timestamp: '1',
    });
    await recordDeliveryStatus(h.db, 'phone', {
      id: 'wamid',
      status: 'read',
      timestamp: 'invalid',
    });
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('does not throw or cause a send retry if telemetry fails', async () => {
    const h = database();
    h.upsert.mockRejectedValue(new Error('database down'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(
      recordDeliveryEvent(h.db, {
        account_id: 'brand',
        phone_number_id: 'phone',
        message_id: 'wamid',
        event_type: 'sent',
        occurred_at: new Date().toISOString(),
      })
    ).resolves.toBeUndefined();
    error.mockRestore();
  });
  it('uses provider delivery time rather than webhook delay and handles partial history', () => {
    const events = [
      {
        event_type: 'delivered',
        occurred_at: '2026-10-19T18:02:00Z',
        received_at: '2026-10-19T18:04:00Z',
      },
      { event_type: 'api_accepted', occurred_at: '2026-10-19T18:00:00Z' },
    ] as DeliveryEvent[];
    expect(deliveryDurations(events).acceptedToDeliveredMs).toBe(120000);
    expect(
      deliveryDurations(events.slice(0, 1)).acceptedToDeliveredMs
    ).toBeNull();
  });
});
