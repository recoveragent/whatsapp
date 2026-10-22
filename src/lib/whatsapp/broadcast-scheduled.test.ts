import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { BroadcastError, deliverBroadcast, finalizeBroadcastStatus } from './broadcast-core';
import { claimBroadcastDelivery, markBroadcastSending, planBroadcastResume, releaseBroadcastDelivery } from './broadcast-resume';
import { processScheduledBroadcasts } from './broadcast-scheduled';

vi.mock('./broadcast-core', async (importOriginal) => ({
  ...await importOriginal<typeof import('./broadcast-core')>(),
  deliverBroadcast: vi.fn(), finalizeBroadcastStatus: vi.fn(),
}));
vi.mock('./broadcast-resume', () => ({
  claimBroadcastDelivery: vi.fn(), markBroadcastSending: vi.fn(),
  planBroadcastResume: vi.fn(), releaseBroadcastDelivery: vi.fn(),
}));

const now = new Date('2026-10-23T10:00:00Z');
function fixture(status = 'scheduled', scheduledAt = now.toISOString()) {
  let reads = 0;
  const writes: unknown[] = [];
  const filters: unknown[] = [];
  const db = { from: () => {
    const response = ++reads === 1
      ? { data: [{ id: 'bc1', account_id: 'a1' }], error: null }
      : { data: { status, scheduled_at: scheduledAt }, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'in', 'lte', 'order', 'limit', 'eq']) {
      chain[method] = (...args: unknown[]) => { filters.push([method, ...args]); return chain; };
    }
    chain.update = (value: unknown) => { writes.push(value); return chain; };
    chain.maybeSingle = async () => response;
    chain.then = (resolve: (value: unknown) => unknown) => resolve(response);
    return chain;
  } } as unknown as SupabaseClient;
  return { db, writes, filters };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(claimBroadcastDelivery).mockResolvedValue(true);
  vi.mocked(planBroadcastResume).mockResolvedValue({ plan: { broadcastId: 'bc1' } as never, remaining: 0, unsendable: 0 });
});

describe('scheduled broadcast worker', () => {
  it('selects only due scheduled campaigns and their unfinished passes, then delivers under the lock', async () => {
    const { db, filters } = fixture();
    expect(await processScheduledBroadcasts(db, now)).toBe(1);
    expect(filters).toContainEqual(['in', 'status', ['scheduled', 'sending']]);
    expect(filters).toContainEqual(['lte', 'scheduled_at', now.toISOString()]);
    expect(claimBroadcastDelivery).toHaveBeenCalledWith(db, 'a1', 'bc1', now);
    expect(markBroadcastSending).toHaveBeenCalledWith(db, 'bc1');
    expect(deliverBroadcast).toHaveBeenCalledOnce();
    expect(releaseBroadcastDelivery).toHaveBeenCalledWith(db, 'bc1');
  });
  it('does not send when another worker holds the lock', async () => {
    vi.mocked(claimBroadcastDelivery).mockResolvedValue(false);
    expect(await processScheduledBroadcasts(fixture().db, now)).toBe(0);
    expect(deliverBroadcast).not.toHaveBeenCalled();
  });
  it.each(['draft', 'sent', 'failed'])('does not send a campaign changed to %s before the claim', async (status) => {
    await processScheduledBroadcasts(fixture(status).db, now);
    expect(planBroadcastResume).not.toHaveBeenCalled();
    expect(releaseBroadcastDelivery).toHaveBeenCalled();
  });
  it('does not send a campaign rescheduled into the future', async () => {
    await processScheduledBroadcasts(fixture('scheduled', '2026-10-24T10:00:00Z').db, now);
    expect(deliverBroadcast).not.toHaveBeenCalled();
  });
  it('finalizes a campaign with no pending recipients', async () => {
    vi.mocked(planBroadcastResume).mockRejectedValue(new BroadcastError('nothing_to_resume', 'No recipients', 400));
    const { db } = fixture();
    await processScheduledBroadcasts(db, now);
    expect(finalizeBroadcastStatus).toHaveBeenCalledWith(db, 'bc1');
    expect(releaseBroadcastDelivery).toHaveBeenCalled();
  });
  it('releases the lock after delivery fails so a later tick can continue', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(deliverBroadcast).mockRejectedValue(new Error('Connection lost'));
    const { db, writes } = fixture('sending');
    expect(await processScheduledBroadcasts(db, now)).toBe(0);
    expect(writes).toEqual([]);
    expect(releaseBroadcastDelivery).toHaveBeenCalledWith(db, 'bc1');
    log.mockRestore();
  });
});
