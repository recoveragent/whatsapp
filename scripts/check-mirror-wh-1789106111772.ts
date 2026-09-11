import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const db = createClient(url, key);
  const checkoutId = 'wh-1789106111772';

  const { data: contacts, error: cErr } = await db
    .from('contacts')
    .select('id, name, phone, created_at, account_id')
    .or('phone.like.%9810159715%,phone.eq.919810159715,phone.eq.9810159715');
  if (cErr) throw cErr;
  console.log('CONTACTS', contacts);

  const { data: pending, error: pErr } = await db
    .from('shopify_pending_checkouts')
    .select(
      'id, account_id, checkout_id, contact_id, status, run_at, error_message, created_at, updated_at, payload',
    )
    .eq('checkout_id', checkoutId)
    .order('created_at', { ascending: false });
  if (pErr) throw pErr;

  console.log(
    'PENDING_CHECKOUTS',
    (pending ?? []).map((row) => ({
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
      phone:
        typeof row.payload === 'object' &&
        row.payload !== null
          ? (row.payload as { event?: { phone?: string } }).event?.phone
          : undefined,
      customer_name:
        typeof row.payload === 'object' &&
        row.payload !== null
          ? (row.payload as { event?: { customer_name?: string } }).event
              ?.customer_name
          : undefined,
    })),
  );

  const contactId =
    pending?.[0]?.contact_id ?? (contacts?.[0]?.id as string | undefined);
  if (contactId) {
    const { data: runs } = await db
      .from('flow_runs')
      .select('status, started_at, flows(name, trigger_type, status)')
      .eq('contact_id', contactId)
      .order('started_at', { ascending: false })
      .limit(3);
    console.log('FLOW_RUNS', runs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
