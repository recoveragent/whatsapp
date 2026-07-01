/**
 * Apply inbox migration 030 to Supabase.
 *
 * Usage (set your database password from Supabase Dashboard → Settings → Database):
 *   $env:SUPABASE_DB_PASSWORD="your-password"
 *   node scripts/apply-migration-030.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;

if (!url || !password) {
  console.error('Need NEXT_PUBLIC_SUPABASE_URL in .env.local and SUPABASE_DB_PASSWORD in env.');
  console.error('Get the password from Supabase Dashboard → Project Settings → Database.');
  process.exit(1);
}

const ref = new URL(url).hostname.split('.')[0];
const connectionString =
  process.env.SUPABASE_DB_URL ??
  `postgresql://postgres.${ref}:${encodeURIComponent(password)}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(
  join(__dirname, '..', 'supabase', 'migrations', '030_inbox_shopify_notes.sql'),
  'utf8',
);

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  await client.query(sql);
  console.log('Migration 030 applied successfully.');
} catch (err) {
  console.error('Migration failed:', err instanceof Error ? err.message : err);
  console.error('You can also paste supabase/migrations/030_inbox_shopify_notes.sql into Supabase SQL Editor.');
  process.exit(1);
} finally {
  await client.end();
}
