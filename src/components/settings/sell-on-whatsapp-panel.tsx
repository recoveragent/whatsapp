"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface SellOnWhatsAppPayload {
  enabled: boolean;
  connected: boolean;
  shop_domain: string | null;
  products_last_synced_at: string | null;
  active_product_count: number;
  product_link_recovery_enabled: boolean;
  product_link_recovery_delay_minutes: number;
  latest_sync: {
    status: string;
    products_upserted?: number;
    products_archived?: number;
    error_message?: string | null;
    finished_at?: string | null;
  } | null;
}

interface SellOnWhatsAppPanelProps {
  connected: boolean;
  canEdit: boolean;
}

export function SellOnWhatsAppPanel({
  connected,
  canEdit,
}: SellOnWhatsAppPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [settings, setSettings] = useState<SellOnWhatsAppPayload | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shopify/sell-on-whatsapp", { cache: "no-store" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to load settings");
      setSettings(payload as SellOnWhatsAppPayload);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load settings");
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (connected) void load();
    else setLoading(false);
  }, [connected, load]);

  const handleToggle = async (enabled: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const res = await fetch("/api/shopify/sell-on-whatsapp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Failed to update settings");

      if (enabled && payload.sync?.status === "failed") {
        toast.error(payload.sync.error_message ?? "Initial product sync failed");
      } else if (enabled) {
        toast.success("Sell on WhatsApp enabled");
      } else {
        toast.success("Sell on WhatsApp disabled");
      }

      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  const patchSettings = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/shopify/sell-on-whatsapp", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.error ?? "Failed to update settings");
    await load();
  };

  const handleRecoveryToggle = async (enabled: boolean) => {
    if (!canEdit) return;
    setSaving(true);
    try {
      await patchSettings({ product_link_recovery_enabled: enabled });
      toast.success(
        enabled ? "Product link recovery enabled" : "Product link recovery disabled",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update settings");
    } finally {
      setSaving(false);
    }
  };

  const handleRecoveryDelaySave = async () => {
    if (!canEdit || !settings) return;
    setSaving(true);
    try {
      await patchSettings({
        product_link_recovery_delay_minutes: settings.product_link_recovery_delay_minutes,
      });
      toast.success("Recovery delay updated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update delay");
    } finally {
      setSaving(false);
    }
  };

  const handleSync = async () => {
    if (!canEdit) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/shopify/products/sync", { method: "POST" });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? "Sync failed");
      toast.success(
        `Synced ${payload.upserted ?? 0} products${payload.archived ? ` · archived ${payload.archived}` : ""}`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (!connected) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingBag className="size-4" />
          Sell on WhatsApp
        </CardTitle>
        <CardDescription>
          Sync products from Shopify and send checkout links from the inbox.
          Customers complete payment on your store.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-3">
              <div className="space-y-1">
                <Label htmlFor="sell-on-whatsapp-toggle">Enable product sends</Label>
                <p className="text-xs text-muted-foreground">
                  {settings?.active_product_count ?? 0} active products cached
                  {settings?.products_last_synced_at
                    ? ` · last synced ${new Date(settings.products_last_synced_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}`
                    : ""}
                </p>
              </div>
              <Switch
                id="sell-on-whatsapp-toggle"
                checked={Boolean(settings?.enabled)}
                disabled={!canEdit || saving}
                onCheckedChange={(checked) => void handleToggle(checked)}
              />
            </div>

            {settings?.latest_sync?.status === "failed" && settings.latest_sync.error_message && (
              <p className="text-xs text-destructive">
                Last sync failed: {settings.latest_sync.error_message}
              </p>
            )}

            {canEdit && settings?.enabled && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={syncing}
                onClick={() => void handleSync()}
              >
                {syncing ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="mr-1.5 size-4" />
                    Sync products now
                  </>
                )}
              </Button>
            )}

            {settings?.enabled && (
              <div className="space-y-3 rounded-lg border border-border px-3 py-3">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-1">
                    <Label htmlFor="product-link-recovery-toggle">
                      Product link recovery
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      Resend the product card if the customer has not placed an order.
                    </p>
                  </div>
                  <Switch
                    id="product-link-recovery-toggle"
                    checked={Boolean(settings.product_link_recovery_enabled)}
                    disabled={!canEdit || saving}
                    onCheckedChange={(checked) => void handleRecoveryToggle(checked)}
                  />
                </div>

                {settings.product_link_recovery_enabled && (
                  <div className="flex items-end gap-2">
                    <div className="flex-1 space-y-1">
                      <Label htmlFor="product-link-recovery-delay">
                        Wait before reminder (minutes)
                      </Label>
                      <Input
                        id="product-link-recovery-delay"
                        type="number"
                        min={5}
                        max={10080}
                        value={settings.product_link_recovery_delay_minutes}
                        disabled={!canEdit || saving}
                        onChange={(e) =>
                          setSettings({
                            ...settings,
                            product_link_recovery_delay_minutes: Number.parseInt(
                              e.target.value || "60",
                              10,
                            ),
                          })
                        }
                        className="bg-muted"
                      />
                    </div>
                    {canEdit && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => void handleRecoveryDelaySave()}
                      >
                        Save
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
