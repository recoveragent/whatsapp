'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import Link from 'next/link';
import {
  ArrowLeft,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  RotateCcw,
  ShoppingBag,
  XCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SettingsPanelHead } from './settings-panel-head';

const MASKED_TOKEN = '••••••••••••••••';

interface SafeConfigRow {
  shop_domain: string;
  scopes: string[];
  status: string;
  connected_at: string | null;
  has_access_token: boolean;
}

interface ShopifyConfigProps {
  brandId: string;
  brandName?: string;
}

export function ShopifyConfig({ brandId, brandName }: ShopifyConfigProps) {
  const apiBase = useMemo(() => `/api/admin/brands/${brandId}/shopify`, [brandId]);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [config, setConfig] = useState<SafeConfigRow | null>(null);
  const [resolvedBrandName, setResolvedBrandName] = useState(brandName ?? '');
  const [connected, setConnected] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');

  const [shopDomain, setShopDomain] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [tokenEdited, setTokenEdited] = useState(false);

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

      if (data?.shop_domain) {
        setShopDomain(data.shop_domain.replace('.myshopify.com', ''));
      }
      setAccessToken(data?.has_access_token ? MASKED_TOKEN : '');
      setTokenEdited(false);
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
      const body: Record<string, string> = {
        shop_domain: shopDomain.includes('.myshopify.com')
          ? shopDomain
          : `${shopDomain}.myshopify.com`,
      };
      if (tokenEdited && accessToken !== MASKED_TOKEN) {
        body.access_token = accessToken;
      }

      const res = await fetch(apiBase, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Save failed');

      toast.success('Shopify configuration saved');
      await fetchConfig();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!confirm('Remove Shopify configuration for this brand?')) return;
    setResetting(true);
    try {
      const res = await fetch(apiBase, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Reset failed');
      toast.success('Configuration removed');
      setShopDomain('');
      setAccessToken('');
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
        title="Shopify setup"
        description={
          resolvedBrandName
            ? `Configure Shopify for ${resolvedBrandName}`
            : 'Ops-level Shopify credentials for this brand'
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
                {statusMessage || 'Enter a custom app access token or let brand admins use OAuth.'}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {webhookUrl && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Webhook URL</CardTitle>
              <CardDescription>
                Registered automatically on save. Add this to your Shopify app if needed.
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
              <ShoppingBag className="size-4" />
              Store credentials
            </CardTitle>
            <CardDescription>
              Use a Shopify custom app admin API access token, or let brand admins connect via OAuth
              in Settings → Shopify.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="shop-domain">Shop domain</Label>
                <div className="flex gap-2">
                  <Input
                    id="shop-domain"
                    value={shopDomain}
                    onChange={(e) => setShopDomain(e.target.value)}
                    placeholder="your-store"
                    required
                  />
                  <span className="flex items-center text-sm text-muted-foreground whitespace-nowrap">
                    .myshopify.com
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="access-token">Admin API access token</Label>
                <div className="relative">
                  <Input
                    id="access-token"
                    type={showToken ? 'text' : 'password'}
                    value={accessToken}
                    onChange={(e) => {
                      setAccessToken(e.target.value);
                      setTokenEdited(true);
                    }}
                    placeholder="shpat_..."
                    required={!config?.has_access_token}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setShowToken((v) => !v)}
                  >
                    {showToken ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </Button>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : 'Save configuration'}
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
