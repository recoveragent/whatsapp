import { config } from 'dotenv';

config({ path: '.env.local' });

async function rest<T>(path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }
  return (await response.json()) as T;
}

async function main() {
  const contacts = await rest<
    Array<{ id: string; name: string; phone: string; created_at: string }>
  >('contacts?phone=eq.919810159715&select=id,name,phone,created_at');

  console.log('CONTACT', contacts[0] ?? null);
  if (!contacts[0]) return;

  const rows = await rest<
    Array<{
      checkout_id: string;
      status: string;
      run_at: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      payload: { event?: Record<string, unknown> } | null;
    }>
  >(
    `shopify_pending_checkouts?contact_id=eq.${contacts[0].id}&select=checkout_id,status,run_at,error_message,created_at,updated_at,payload&order=created_at.desc`,
  );

  for (const row of rows) {
    console.log('---');
    console.log('checkout_id:', row.checkout_id);
    console.log('status:', row.status);
    console.log('run_at:', row.run_at);
    console.log('created_at:', row.created_at);
    console.log('event:', JSON.stringify(row.payload?.event ?? row.payload, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
