'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  RotateCcw,
  Store,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

interface SafeConfigRow {
  store_url: string;
  status: string;
  connected_at: string | null;
  has_credentials: boolean;
}

interface WooCommerceConfigProps {
  brandId: string;
  brandName?: string;
}

export function WooCommerceConfig({ brandId, brandName }: WooCommerceConfigProps) {
  const apiBase = useMemo(() => `/api/admin/brands/${brandId}/woocommerce`, [brandId]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [config, setConfig] = useState<SafeConfigRow | null>(null);
  const [resolvedBrandName, setResolvedBrandName] = useState(brandName ?? '');
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiBase, { cache: 'no-store' });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error ?? 'Failed to load configuration');

      if (payload.brand?.name) setResolvedBrandName(payload.brand.name);
      if (payload.webhook_url) setWebhookUrl(payload.webhook_url);

      const data = payload.config as SafeConfigRow | null;
      const health = payload.health as { connected?: boolean; message?: string };

      setConfig(data);
      setConnected(Boolean(health?.connected));
      setStatusMessage(health?.message ?? '');

      if (data?.store_url) setStoreUrl(data.store_url);
      setConsumerKey('');
      setConsumerSecret('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    void fetchConfig();
  }, [fetchConfig]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_url: storeUrl.trim(),
          consumer_key: consumerKey.trim(),
          consumer_secret: consumerSecret.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      toast.success('WooCommerce configuration saved');
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Remove WooCommerce configuration for this brand?')) return;
    setResetting(true);
    try {
      const res = await fetch(apiBase, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reset failed');
      toast.success('Configuration removed');
      setStoreUrl('');
      setConsumerKey('');
      setConsumerSecret('');
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  const copyWebhook = () => {
    void navigator.clipboard.writeText(webhookUrl);
    toast.success('Webhook URL copied');
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/admin/brands"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to brands
      </Link>

      <SettingsPanelHead
        title="WooCommerce setup"
        description={
          resolvedBrandName
            ? `Configure WooCommerce for ${resolvedBrandName}`
            : 'Ops-level WooCommerce credentials for this brand'
        }
      />

      <div className="max-w-xl space-y-6">
        <Alert
          className={
            connected
              ? 'bg-emerald-950/30 border-emerald-700/50'
              : config
                ? 'bg-amber-950/30 border-amber-700/50'
                : 'bg-card border-border'
          }
        >
          <div className="flex items-start gap-3">
            {connected ? (
              <CheckCircle2 className="size-5 text-emerald-400 mt-0.5" />
            ) : (
              <XCircle className="size-5 text-muted-foreground mt-0.5" />
            )}
            <div>
              <AlertTitle className="text-foreground">
                {connected ? 'Store connected' : config ? 'Needs attention' : 'Not configured'}
              </AlertTitle>
              <AlertDescription className="text-sm text-muted-foreground">
                {statusMessage ||
                  'Enter REST API keys from WooCommerce → Settings → Advanced → REST API.'}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {webhookUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook URL</CardTitle>
              <CardDescription>
                Registered automatically on save for order.created and order.updated.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex gap-2">
              <Input readOnly value={webhookUrl} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copyWebhook}>
                <Copy className="size-4" />
              </Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Store className="size-4" />
              Store credentials
            </CardTitle>
            <CardDescription>
              Brand admins can also connect from Settings → WooCommerce. Ops can paste keys here
              on their behalf.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="woo-store-url">Store URL</Label>
                <Input
                  id="woo-store-url"
                  value={storeUrl}
                  onChange={(e) => setStoreUrl(e.target.value)}
                  placeholder="https://your-store.com"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="woo-consumer-key">Consumer key</Label>
                <Input
                  id="woo-consumer-key"
                  value={consumerKey}
                  onChange={(e) => setConsumerKey(e.target.value)}
                  placeholder="ck_..."
                  required={!config?.has_credentials}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="woo-consumer-secret">Consumer secret</Label>
                <Input
                  id="woo-consumer-secret"
                  type="password"
                  value={consumerSecret}
                  onChange={(e) => setConsumerSecret(e.target.value)}
                  placeholder="cs_..."
                  required={!config?.has_credentials}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      Save configuration
                      <ExternalLink className="ml-1.5 size-4" />
                    </>
                  )}
                </Button>
                {config && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={resetting}
                    onClick={() => void handleReset()}
                  >
                    {resetting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="mr-1.5 size-4" />
                        Reset
                      </>
                    )}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
