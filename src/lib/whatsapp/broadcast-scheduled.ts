import type { SupabaseClient } from '@supabase/supabase-js';
import { BroadcastError, deliverBroadcast, finalizeBroadcastStatus } from './broadcast-core';
import { claimBroadcastDelivery, markBroadcastSending, planBroadcastResume, releaseBroadcastDelivery } from './broadcast-resume';

/** Drain due campaigns in bounded passes. Existing delivery locks prevent
 * overlapping cron runs or manual resumes from sending the same batch. */
export async function processScheduledBroadcasts(db: SupabaseClient, now = new Date()): Promise<number> {
  const { data: due, error } = await db.from('broadcasts')
    .select('id, account_id')
    .in('status', ['scheduled', 'sending'])
    .lte('scheduled_at', now.toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);

  let processed = 0;
  for (const row of due ?? []) {
    if (!await claimBroadcastDelivery(db, row.account_id, row.id, now)) continue;
    try {
      // Re-read after claiming so a deleted/cancelled campaign is never sent.
      const { data: current, error: readError } = await db.from('broadcasts')
        .select('status, scheduled_at').eq('id', row.id).eq('account_id', row.account_id).maybeSingle();
      if (readError) throw new Error(readError.message);
      if (!current || !['scheduled', 'sending'].includes(current.status) ||
          !current.scheduled_at || new Date(current.scheduled_at).getTime() > now.getTime()) continue;
      const { plan } = await planBroadcastResume(db, row.account_id, row.id, 'pending');
      await markBroadcastSending(db, row.id);
      await deliverBroadcast(db, plan);
      processed++;
    } catch (err) {
      if (err instanceof BroadcastError && err.code === 'nothing_to_resume') {
        await finalizeBroadcastStatus(db, row.id);
      } else if (err instanceof BroadcastError) {
        await db.from('broadcasts').update({ status: 'failed' }).eq('id', row.id);
        console.error('[scheduled-broadcast] planning failed:', row.id, err.message);
      } else {
        // Infrastructure failures leave pending recipients available next tick.
        console.error('[scheduled-broadcast] delivery failed:', row.id, err);
      }
    } finally {
      await releaseBroadcastDelivery(db, row.id);
    }
  }
  return processed;
}
