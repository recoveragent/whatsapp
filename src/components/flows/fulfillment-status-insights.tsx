"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  selectedShipmentStatuses,
  shipmentRoutesFromConfig,
  shipmentStatusFilterLabel,
} from "@/lib/flows/trigger-types";
import {
  type FulfillmentStatusStatRow,
  type FulfillmentStatusStats,
} from "@/lib/shopify/fulfillment-status-stats";

function toggleShipmentStatus(
  config: Record<string, unknown>,
  status: string,
  on: boolean,
): Record<string, unknown> {
  const current = selectedShipmentStatuses(config);
  const next = on
    ? current.includes(status)
      ? current
      : [...current, status]
    : current.filter((x) => x !== status);
  const routes = shipmentRoutesFromConfig(config);
  const pruned = Object.fromEntries(
    Object.entries(routes).filter(([key]) => next.includes(key)),
  );
  return {
    ...config,
    shipment_status: next.length === 1 ? next[0] : "any",
    shipment_statuses: next,
    shipment_routes: pruned,
  };
}

function rowsForPicker(
  stats: FulfillmentStatusStats | null,
  selected: string[],
): FulfillmentStatusStatRow[] {
  const rows = [...(stats?.statuses ?? [])];
  for (const status of selected) {
    if (rows.some((row) => row.status === status)) continue;
    rows.push({
      status,
      label: shipmentStatusFilterLabel(status),
      count: 0,
      last_seen: "",
      known: true,
    });
  }
  return rows;
}

export function FulfillmentStatusInsights({
  triggerConfig,
  onTriggerConfigChange,
}: {
  triggerConfig: Record<string, unknown>;
  onTriggerConfigChange: (config: Record<string, unknown>) => void;
}) {
  const [stats, setStats] = useState<FulfillmentStatusStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/shopify/fulfillment-statuses?days=7");
      const json = (await res.json()) as FulfillmentStatusStats & { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Failed to load fulfillment statuses");
      }
      setStats(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = selectedShipmentStatuses(triggerConfig);
  const rows = useMemo(() => rowsForPicker(stats, selected), [stats, selected]);
  const maxCount = Math.max(...rows.map((s) => s.count), 1);

  return (
    <div className="mt-1">
      <p className="mb-1 text-[10px] leading-snug text-muted-foreground">
        Leave all unchecked to run on any fulfillment update. Only statuses
        received in the last 7 days are listed — check more than one to get a
        handle per status on the trigger.
      </p>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-foreground">
              Statuses received (last 7 days)
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              Shopify{" "}
              <code className="rounded bg-muted px-1">shipment_status</code> from
              fulfillment webhooks. Unchecked means this flow does not filter by
              carrier stage.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          >
            Refresh
          </button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading recent fulfillment events…
          </div>
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No fulfillment webhooks in the last 7 days. Leave this empty to run
            on any fulfill until statuses start arriving.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[10px] text-muted-foreground">
              {stats?.total_events ?? 0} webhook event
              {(stats?.total_events ?? 0) === 1 ? "" : "s"} in the last{" "}
              {stats?.days ?? 7} days.
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {rows.map((row) => {
                const isOn = selected.includes(row.status);
                const widthPct = Math.max(4, (row.count / maxCount) * 100);
                return (
                  <li key={row.status}>
                    <button
                      type="button"
                      onClick={() =>
                        onTriggerConfigChange(
                          toggleShipmentStatus(triggerConfig, row.status, !isOn),
                        )
                      }
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition-colors",
                        isOn
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border bg-background/60 text-muted-foreground hover:text-foreground hover:bg-background",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                          isOn
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-border",
                        )}
                      >
                        {isOn ? <Check className="size-3" /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium text-foreground">
                          {row.label}
                        </span>
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                            <span
                              className="block h-full rounded-full bg-primary/70"
                              style={{ width: `${widthPct}%` }}
                            />
                          </span>
                          <span className="shrink-0 tabular-nums text-[10px] text-muted-foreground">
                            {row.count}
                          </span>
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {selected.length > 0 ? (
              <button
                type="button"
                onClick={() =>
                  onTriggerConfigChange({
                    ...triggerConfig,
                    shipment_status: "any",
                    shipment_statuses: [],
                    shipment_routes: {},
                  })
                }
                className="mt-2 text-[10px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Clear selection (any fulfill)
              </button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
