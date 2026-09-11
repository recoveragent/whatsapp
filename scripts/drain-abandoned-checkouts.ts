import { config } from 'dotenv';

config({ path: '.env.local' });

async function main() {
  const { createClient } = await import('@supabase/supabase-js');
  const { processDueAbandonedCheckouts } = await import(
    '../src/lib/shopify/handle-webhook'
  );

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const db = createClient(url, key);
  const processed = await processDueAbandonedCheckouts(db);
  console.log('processed', processed);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
