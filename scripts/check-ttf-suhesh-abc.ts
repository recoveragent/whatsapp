import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const db = createClient(url, key);

  const istWindowStart = '2026-09-10T16:30:00.000Z';
  const istFireAfter = '2026-09-10T16:44:00.000Z';

  const { data: ttfAccount, error: accountErr } = await db
    .from('accounts')
    .select('id, name')
    .ilike('name', '%TTF%')
    .maybeSingle();
  if (accountErr) throw accountErr;
  console.log('ACCOUNT', ttfAccount);
  if (!ttfAccount) return;

  const { data: contacts, error: contactErr } = await db
    .from('contacts')
    .select('id, name, phone, created_at, updated_at')
    .eq('account_id', ttfAccount.id)
    .or(
      'phone.eq.919778180467,phone.eq.9778180467,phone.eq.+919778180467',
    );
  if (contactErr) throw contactErr;
  console.log('CONTACTS', contacts);

  const contactId = contacts?.[0]?.id;
  if (contactId) {
    const { data: pending, error: pendingErr } = await db
      .from('shopify_pending_checkouts')
      .select(
        'id, checkout_id, status, run_at, error_message, created_at, updated_at, payload',
      )
      .eq('account_id', ttfAccount.id)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(5);
    if (pendingErr) throw pendingErr;
    console.log(
      'PENDING_CHECKOUTS',
      pending?.map((row) => ({
        id: row.id,
        checkout_id: row.checkout_id,
        status: row.status,
        run_at: row.run_at,
        error_message: row.error_message,
        created_at: row.created_at,
        updated_at: row.updated_at,
        mirror:
          typeof row.payload === 'object' &&
          row.payload !== null &&
          (row.payload as { _wa_recover_agent_mirror?: boolean })
            ._wa_recover_agent_mirror === true,
        customer_name:
          typeof row.payload === 'object' &&
          row.payload !== null &&
          (row.payload as { event?: { customer_name?: string } }).event
            ?.customer_name,
      })),
    );

    const { data: flows } = await db
      .from('flows')
      .select('id, name, status, trigger_type')
      .eq('account_id', ttfAccount.id)
      .ilike('name', '%ABC%');
    console.log('ABC_FLOWS', flows);

    const abcFlowIds = (flows ?? []).map((f) => f.id as string);
    if (abcFlowIds.length > 0) {
      const { data: flowRuns } = await db
        .from('flow_runs')
        .select('id, flow_id, status, created_at, updated_at, idempotency_key')
        .eq('contact_id', contactId)
        .in('flow_id', abcFlowIds)
        .gte('created_at', istFireAfter)
        .order('created_at', { ascending: false });
      console.log('ABC_FLOW_RUNS_AFTER_FIRE', flowRuns);
    }

    const { data: allRecentRuns } = await db
      .from('flow_runs')
      .select('id, flow_id, status, created_at, idempotency_key, flows(name, trigger_type)')
      .eq('contact_id', contactId)
      .gte('created_at', istWindowStart)
      .order('created_at', { ascending: false })
      .limit(10);
    console.log('ALL_FLOW_RUNS_SINCE_22IST', allRecentRuns);
  }

  const { data: backlog } = await db
    .from('shopify_pending_checkouts')
    .select('id, checkout_id, status, run_at, created_at, contact_id')
    .eq('account_id', ttfAccount.id)
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .order('run_at', { ascending: true })
    .limit(10);
  console.log('DUE_PENDING_BACKLOG', backlog);

  const { data: recentProcessed } = await db
    .from('shopify_pending_checkouts')
    .select('id, checkout_id, status, run_at, error_message, updated_at')
    .eq('account_id', ttfAccount.id)
    .in('status', ['sent', 'cancelled', 'failed'])
    .gte('updated_at', istWindowStart)
    .order('updated_at', { ascending: false })
    .limit(10);
  console.log('RECENT_PROCESSED_CHECKOUTS', recentProcessed);

  const { data: checkoutAppFlows } = await db
    .from('flows')
    .select('id, name, status, trigger_type')
    .eq('account_id', ttfAccount.id)
    .eq('trigger_type', 'shopify_checkout_app_abandoned');
  console.log('CHECKOUT_APP_FLOWS', checkoutAppFlows);

  const { data: waConfig } = await db
    .from('whatsapp_config')
    .select('account_id, phone_number_id, status')
    .eq('account_id', ttfAccount.id)
    .maybeSingle();
  console.log('WHATSAPP_CONFIG', waConfig);

  const { data: campaign } = await db
    .from('shopify_campaigns')
    .select('campaign_type, is_enabled, template_name')
    .eq('account_id', ttfAccount.id)
    .eq('campaign_type', 'abandoned_checkout')
    .maybeSingle();
  console.log('ABANDONED_CAMPAIGN', campaign);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
