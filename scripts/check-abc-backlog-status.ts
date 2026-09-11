import { config } from 'dotenv';

config({ path: '.env.local' });

const CHECKOUT_IDS = [
  'wh-1789106111772',
  'wh-1789097065149',
  '07d9c0a1-5a0e-4731-bad6-a9e88fc10912',
  'e75a9ca3-3b04-40c5-9df3-3051f2550c72',
];

const PHONES = ['919810159715', '919513668779', '918080155821', '919778180467'];

async function main() {
  const { createClient } = await import('@supabase/supabase-js');

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const db = createClient(url, key);

  const { data: pending } = await db
    .from('shopify_pending_checkouts')
    .select('checkout_id, status, run_at, error_message, updated_at')
    .in('checkout_id', CHECKOUT_IDS)
    .order('updated_at', { ascending: false });
  console.log('CHECKOUTS', pending);

  const { data: dueBacklog } = await db
    .from('shopify_pending_checkouts')
    .select('id, checkout_id, status, run_at')
    .eq('account_id', 'ff0f22fa-3864-4140-8101-26e4d029acb6')
    .eq('status', 'pending')
    .lte('run_at', new Date().toISOString())
    .limit(10);
  console.log('TTF_DUE_PENDING', dueBacklog);

  for (const phone of PHONES) {
    const { data: contact } = await db
      .from('contacts')
      .select('id, name, phone')
      .eq('phone', phone)
      .maybeSingle();
    if (!contact) {
      console.log('CONTACT', phone, 'not found');
      continue;
    }
    const { data: runs } = await db
      .from('flow_runs')
      .select('status, started_at, ended_at, flows(name, trigger_type)')
      .eq('contact_id', contact.id)
      .order('started_at', { ascending: false })
      .limit(2);
    console.log('FLOW_RUNS', contact.name, phone, runs);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
