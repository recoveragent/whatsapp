'use client';

import { useState } from 'react';
import { recentOrderVariableOptions } from '@/lib/flows/recent-order-variable-options';
import { Input } from '@/components/ui/input';

type SampleOrder = Record<string, unknown>;

interface Sample {
  key: string;
  title: string;
  subtitle: string;
  payload: SampleOrder;
}

/** Orders preview Shopify orders; checkouts preview saved abandoned checkouts. */
const SOURCES = {
  orders: {
    button: 'From recent order',
    endpoint: '/api/shopify/orders/recent',
    help: 'Preview an order, then select a field. Its value comes from the triggering order when the flow runs. Checkout triggers only provide fields present in their checkout payload.',
    loading: 'Loading recent orders…',
    loadError: 'Could not load recent orders.',
    empty: 'No recent orders found.',
    search: 'Search order payload',
    toSamples: (body: { orders?: SampleOrder[] }): Sample[] =>
      (body.orders ?? []).map((order) => ({
        key: String(order.id),
        title: `${String(order.name ?? order.order_number ?? order.id)} · ${String(order.total_price ?? '')} ${String(order.currency ?? '')}`,
        subtitle: String(order.created_at ?? ''),
        payload: order,
      })),
  },
  woocommerce: {
    button: 'From recent WooCommerce order',
    endpoint: '/api/woocommerce/orders/recent',
    help: 'Preview an order, then select a field. Its value comes from the triggering WooCommerce order when the flow runs.',
    loading: 'Loading recent orders…',
    loadError: 'Could not load recent orders.',
    empty: 'No recent orders found.',
    search: 'Search WooCommerce order payload',
    toSamples: (body: { orders?: SampleOrder[] }): Sample[] =>
      (body.orders ?? []).map((order) => ({
        key: String(order.id),
        title: `#${String(order.number ?? order.id)} · ${String(order.total ?? '')} ${String(order.currency ?? '')}`,
        subtitle: String(order.date_created ?? ''),
        payload: order,
      })),
  },
  checkouts: {
    button: 'From recent checkout',
    endpoint: '/api/shopify/checkouts/recent',
    help: 'Preview a saved abandoned checkout, then select a field. Its value comes from the triggering checkout when the flow runs.',
    loading: 'Loading recent checkouts…',
    loadError: 'Could not load recent checkouts.',
    empty:
      'No saved checkouts yet. One appears after the next abandoned checkout.',
    search: 'Search checkout payload',
    toSamples: (body: {
      checkouts?: Array<{
        checkout_id: string;
        created_at: string;
        payload: SampleOrder;
      }>;
    }): Sample[] =>
      (body.checkouts ?? []).map((checkout) => ({
        key: checkout.checkout_id,
        title: `${checkout.checkout_id} · ${String(checkout.payload.total_price ?? '')} ${String(checkout.payload.currency ?? '')}`,
        subtitle: checkout.created_at,
        payload: checkout.payload,
      })),
  },
} as const;

export function RecentOrderVariables({
  onInsert,
  source = 'orders',
}: {
  onInsert: (token: string) => void;
  source?: keyof typeof SOURCES;
}) {
  const config = SOURCES[source];
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<Sample[] | null>(null);
  const [selected, setSelected] = useState<Sample | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch(config.endpoint, {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || config.loadError);
      setOrders(config.toSamples(body));
    } catch (err) {
      setError(err instanceof Error ? err.message : config.loadError);
    } finally {
      setLoading(false);
    }
  }

  const fields = selected
    ? recentOrderVariableOptions(
        selected.payload,
        source === 'woocommerce' ? 'woocommerce_order' : 'shopify_order'
      ).filter(({ label, value }) =>
        `${label} ${value}`.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  return (
    <div className="border-border mt-1 border-t pt-1">
      <button
        type="button"
        className="hover:bg-muted w-full rounded px-2 py-2 text-left text-xs"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && orders === null && !loading) void load();
        }}
      >
        {config.button}
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2">
          <p className="text-muted-foreground text-[10px]">{config.help}</p>
          {loading && (
            <p role="status" className="text-xs">
              {config.loading}
            </p>
          )}
          {error && (
            <div role="alert" className="text-destructive text-xs">
              {error}{' '}
              <button
                type="button"
                className="underline"
                onClick={() => void load()}
              >
                Retry
              </button>
            </div>
          )}
          {orders?.length === 0 && (
            <p className="text-muted-foreground text-xs">{config.empty}</p>
          )}
          {orders?.map((sample) => (
            <button
              type="button"
              key={sample.key}
              aria-pressed={selected === sample}
              className={`block w-full rounded border px-2 py-1.5 text-left text-xs ${selected === sample ? 'border-primary bg-muted' : 'border-border hover:bg-muted'}`}
              onClick={() => {
                setSelected(sample);
                setQuery('');
              }}
            >
              {sample.title}
              <span className="text-muted-foreground block text-[10px]">
                {sample.subtitle}
              </span>
            </button>
          ))}
          {selected && (
            <>
              <Input
                aria-label={config.search}
                placeholder="Search fields or values…"
                className="h-8 text-xs"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {fields.length === 0 && (
                <p className="text-muted-foreground text-xs">
                  No matching fields.
                </p>
              )}
              {fields.map(({ path, label, value, token }) => (
                <button
                  type="button"
                  key={path}
                  className="hover:bg-muted block w-full rounded px-2 py-1.5 text-left"
                  onClick={() => onInsert(token)}
                >
                  <span className="block font-mono text-[10px] break-all">
                    {label}
                  </span>
                  <span className="text-muted-foreground block text-xs break-all">
                    {value === '' ? '(empty string)' : value}
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
