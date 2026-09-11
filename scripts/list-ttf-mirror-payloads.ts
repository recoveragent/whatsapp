import { config } from 'dotenv';

config({ path: '.env.local' });

type MirrorEvent = {
  event?: string;
  checkout_id?: string;
  phone?: string;
  customer_name?: string;
  product?: string;
  amount?: number;
  checkout_url?: string;
  fire_after?: string;
  flat?: Record<string, unknown>;
  raw?: unknown;
  metadata?: { source?: string; company_id?: string; workflow_slug?: string };
};

async function rest<T>(path: string): Promise<T> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Missing Supabase env');

  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

function imageFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const items = (raw as { items?: Array<{ image?: string; image_url?: string }> }).items;
  const first = items?.[0];
  return first?.image?.trim() || first?.image_url?.trim() || null;
}

async function main() {
  const ttfAccountId = 'ff0f22fa-3864-4140-8101-26e4d029acb6';

  const rows = await rest<
    Array<{
      id: string;
      checkout_id: string;
      contact_id: string | null;
      status: string;
      run_at: string;
      error_message: string | null;
      created_at: string;
      updated_at: string;
      payload: { _wa_recover_agent_mirror?: boolean; event?: MirrorEvent } | null;
    }>
  >(
    `shopify_pending_checkouts?account_id=eq.${ttfAccountId}&select=id,checkout_id,contact_id,status,run_at,error_message,created_at,updated_at,payload&order=created_at.desc&limit=200`,
  );

  const mirrors = rows.filter(
    (row) =>
      row.payload?._wa_recover_agent_mirror === true ||
      row.payload?.event?.metadata?.source === 'abc_webhook_intake',
  );

  const contactIds = [
    ...new Set(mirrors.map((r) => r.contact_id).filter(Boolean) as string[]),
  ];
  const contactsById = new Map<string, { name: string; phone: string }>();
  if (contactIds.length > 0) {
    const contacts = await rest<
      Array<{ id: string; name: string; phone: string }>
    >(`contacts?id=in.(${contactIds.join(',')})&select=id,name,phone`);
    for (const c of contacts) contactsById.set(c.id, { name: c.name, phone: c.phone });
  }

  const flowRunsByContact = new Map<string, Array<{ status: string; started_at: string; flow_name: string }>>();
  for (const contactId of contactIds) {
    const runs = await rest<
      Array<{ status: string; started_at: string; flows: { name: string } | null }>
    >(
      `flow_runs?contact_id=eq.${contactId}&select=status,started_at,flows(name)&order=started_at.desc&limit=5`,
    );
    flowRunsByContact.set(
      contactId,
      runs.map((r) => ({
        status: r.status,
        started_at: r.started_at,
        flow_name: r.flows?.name ?? '?',
      })),
    );
  }

  const table = mirrors.map((row) => {
    const event = row.payload?.event ?? {};
    const contact = row.contact_id ? contactsById.get(row.contact_id) : undefined;
    const runs = row.contact_id ? flowRunsByContact.get(row.contact_id) ?? [] : [];
    const abcRun = runs.find((r) => r.flow_name === 'ABC');

    let outcome: 'accepted_processed' | 'accepted_skipped' | 'queued' | 'unknown';
    if (row.status === 'sent') outcome = 'accepted_processed';
    else if (row.status === 'pending') outcome = 'queued';
    else if (row.status === 'cancelled' || row.status === 'failed')
      outcome = 'accepted_skipped';
    else outcome = 'unknown';

    return {
      mirror_received_at: row.created_at,
      fire_after: row.run_at,
      processed_at: row.status !== 'pending' ? row.updated_at : null,
      checkout_id: row.checkout_id,
      phone: event.phone ?? contact?.phone ?? null,
      customer_name: event.customer_name ?? contact?.name ?? null,
      product: event.product ?? null,
      amount: event.amount ?? null,
      checkout_url: event.checkout_url ?? null,
      product_image_raw: imageFromRaw(event.raw),
      product_image_flat:
        typeof event.flat?.product_image === 'string'
          ? event.flat.product_image
          : null,
      queue_status: row.status,
      skip_reason: row.error_message,
      abc_flow_run: abcRun
        ? `${abcRun.status} @ ${abcRun.started_at}`
        : runs.length
          ? runs[0]
            ? `${runs[0].flow_name} ${runs[0].status}`
            : 'none'
          : 'none',
      outcome,
      metadata_source: event.metadata?.source ?? null,
    };
  });

  console.log(JSON.stringify(table, null, 2));
  console.log('SUMMARY', {
    total_mirrors: table.length,
    processed: table.filter((r) => r.outcome === 'accepted_processed').length,
    skipped: table.filter((r) => r.outcome === 'accepted_skipped').length,
    queued: table.filter((r) => r.outcome === 'queued').length,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
