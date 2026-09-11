import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const db = createClient(url, key);
  const checkoutId = '07d9c0a1-5a0e-4731-bad6-a9e88fc10912';

  const { data: contacts, error: cErr } = await db
    .from('contacts')
    .select('id, name, phone, created_at, account_id')
    .or('phone.like.%8080155821%,phone.eq.918080155821,phone.eq.8080155821');
  if (cErr) throw cErr;
  console.log('CONTACTS', contacts);

  const contactIds = (contacts ?? []).map((c) => c.id as string);

  let pendingQuery = db
    .from('shopify_pending_checkouts')
    .select(
      'id, account_id, checkout_id, contact_id, status, run_at, error_message, created_at, updated_at, payload',
    )
    .eq('checkout_id', checkoutId);

  if (contactIds.length > 0) {
    pendingQuery = db
      .from('shopify_pending_checkouts')
      .select(
        'id, account_id, checkout_id, contact_id, status, run_at, error_message, created_at, updated_at, payload',
      )
      .or(`checkout_id.eq.${checkoutId},contact_id.in.(${contactIds.join(',')})`);
  }

  const { data: pending, error: pErr } = await pendingQuery.order('created_at', {
    ascending: false,
  });
  if (pErr) throw pErr;

  console.log(
    'PENDING_CHECKOUTS',
    (pending ?? []).map((row) => ({
      id: row.id,
      checkout_id: row.checkout_id,
      contact_id: row.contact_id,
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
        row.payload !== null
          ? (row.payload as { event?: { customer_name?: string } }).event
              ?.customer_name
          : undefined,
    })),
  );

  for (const contact of contacts ?? []) {
    const { data: runs, error: rErr } = await db
      .from('flow_runs')
      .select('status, started_at, flow_id, flows(name, trigger_type, status)')
      .eq('contact_id', contact.id)
      .order('started_at', { ascending: false })
      .limit(3);
    if (rErr) throw rErr;
    console.log('FLOW_RUNS', {
      contact: { id: contact.id, name: contact.name, phone: contact.phone },
      runs,
    });

    const { data: abcFlows } = await db
      .from('flows')
      .select('id, name, status, trigger_type')
      .eq('account_id', contact.account_id)
      .eq('trigger_type', 'shopify_checkout_app_abandoned');
    console.log('CHECKOUT_APP_FLOWS', abcFlows);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
