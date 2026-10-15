'use client';

import { useState } from 'react';
import { recentOrderVariableOptions } from '@/lib/flows/recent-order-variable-options';
import { Input } from '@/components/ui/input';

type SampleOrder = Record<string, unknown>;

export function RecentOrderVariables({
  onInsert,
}: {
  onInsert: (token: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<SampleOrder[] | null>(null);
  const [selected, setSelected] = useState<SampleOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/shopify/orders/recent', {
        cache: 'no-store',
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || 'Could not load recent orders.');
      setOrders(body.orders);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Could not load recent orders.'
      );
    } finally {
      setLoading(false);
    }
  }

  const fields = selected
    ? recentOrderVariableOptions(selected).filter(({ label, value }) =>
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
        From recent order
      </button>
      {open && (
        <div className="space-y-2 px-2 pb-2">
          <p className="text-muted-foreground text-[10px]">
            Preview an order, then select a field. Its value comes from the
            triggering order when the flow runs. Checkout triggers only provide
            fields present in their checkout payload.
          </p>
          {loading && (
            <p role="status" className="text-xs">
              Loading recent orders…
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
            <p className="text-muted-foreground text-xs">
              No recent orders found.
            </p>
          )}
          {orders?.map((order) => (
            <button
              type="button"
              key={String(order.id)}
              aria-pressed={selected === order}
              className={`block w-full rounded border px-2 py-1.5 text-left text-xs ${selected === order ? 'border-primary bg-muted' : 'border-border hover:bg-muted'}`}
              onClick={() => {
                setSelected(order);
                setQuery('');
              }}
            >
              {String(order.name ?? order.order_number ?? order.id)} ·{' '}
              {String(order.total_price ?? '')} {String(order.currency ?? '')}
              <span className="text-muted-foreground block text-[10px]">
                {String(order.created_at ?? '')}
              </span>
            </button>
          ))}
          {selected && (
            <>
              <Input
                aria-label="Search order payload"
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
