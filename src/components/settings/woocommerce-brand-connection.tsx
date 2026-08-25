'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Store,
  Unlink,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SettingsPanelHead } from './settings-panel-head';

interface AccountContextPayload {
  linked?: boolean;
  needsBrandContext?: boolean;
  canEditSettings?: boolean;
  accountId?: string;
  error?: string;
}

interface ConnectionPayload {
  configured: boolean;
  connected: boolean;
  needs_reconnect?: boolean;
  store_url?: string | null;
  store_name?: string | null;
  connected_at?: string | null;
  webhook_url?: string | null;
  message?: string;
  error?: string;
  needsBrandContext?: boolean;
}

export function WooCommerceBrandConnection() {
  const [loading, setLoading] = useState(true);
  const [accountCtx, setAccountCtx] = useState<AccountContextPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storeUrl, setStoreUrl] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerSecret, setConsumerSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);

    try {
      const ctxRes = await fetch('/api/account/context', { cache: 'no-store' });
      const ctx = (await ctxRes.json()) as AccountContextPayload;

      if (!ctxRes.ok) {
        throw new Error(ctx.error ?? 'Could not load workspace context');
      }

      setAccountCtx(ctx);

      if (ctx.needsBrandContext) {
        setConnection({ configured: false, connected: false, needsBrandContext: true });
        return;
      }

      if (!ctx.linked || !ctx.accountId) {
        setConnection({ configured: false, connected: false });
        setLoadError(ctx.error ?? 'Your account is not linked to a workspace yet.');
        return;
      }

      const res = await fetch('/api/woocommerce/connection', { cache: 'no-store' });
      const data = (await res.json()) as ConnectionPayload;

      if (!res.ok) {
        if (data.needsBrandContext) {
          setConnection({ configured: false, connected: false, needsBrandContext: true });
          return;
        }
        throw new Error(data.error ?? 'Failed to load connection status');
      }

      setConnection(data);
      if (data.store_url) setStoreUrl(data.store_url);
    } catch (err) {
      setConnection({ configured: false, connected: false });
      setLoadError(err instanceof Error ? err.message : 'Could not load WooCommerce status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleConnect = async () => {
    if (!storeUrl.trim()) {
      toast.error('Enter your store URL');
      return;
    }
    if (!consumerKey.trim() || !consumerSecret.trim()) {
      toast.error('Enter consumer key and secret');
      return;
    }

    setConnecting(true);
    try {
      const res = await fetch('/api/woocommerce/connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_url: storeUrl.trim(),
          consumer_key: consumerKey.trim(),
          consumer_secret: consumerSecret.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string; store_name?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not connect WooCommerce');

      toast.success(data.store_name ? `Connected to ${data.store_name}` : 'WooCommerce connected');
      setConsumerKey('');
      setConsumerSecret('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not connect WooCommerce');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect WooCommerce from this workspace? Order sync will stop until you reconnect.',
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch('/api/woocommerce/connection', { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Disconnect failed');

      toast.success('WooCommerce disconnected');
      setStoreUrl('');
      setConsumerKey('');
      setConsumerSecret('');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WooCommerce"
          description="Connect your store for order sync."
        />
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </section>
    );
  }

  if (connection?.needsBrandContext || accountCtx?.needsBrandContext) {
    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WooCommerce"
          description="Workspace settings require an active brand."
        />
        <Alert className="max-w-xl bg-card border-border">
          <AlertTitle className="text-foreground">Select a brand first</AlertTitle>
          <AlertDescription className="text-muted-foreground text-sm">
            <Link href="/admin/brands" className="text-primary underline">
              Go to Brands
            </Link>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const configured = connection?.configured ?? false;
  const connected = connection?.connected ?? false;
  const needsReconnect = Boolean(connection?.needs_reconnect ?? (configured && !connected));
  const canEdit = accountCtx?.canEditSettings ?? false;
  const showConnectForm = canEdit && (!configured || needsReconnect);
  const webhookUrl = connection?.webhook_url ?? '';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WooCommerce"
        description={
          configured
            ? 'Your connected WooCommerce store for order sync.'
            : 'Connect with REST API keys from WooCommerce → Settings → Advanced → REST API.'
        }
      />

      <div className="space-y-6 max-w-2xl">
        <Alert
          className={
            configured && connected
              ? 'bg-emerald-950/30 border-emerald-700/50'
              : configured && needsReconnect
                ? 'bg-amber-950/30 border-amber-700/50'
                : 'bg-card border-border'
          }
        >
          <div className="flex items-start gap-3">
            {configured && connected ? (
              <CheckCircle2 className="size-5 text-emerald-400 mt-0.5 shrink-0" />
            ) : (
              <XCircle className="size-5 text-muted-foreground mt-0.5 shrink-0" />
            )}
            <div>
              <AlertTitle className="text-foreground mb-1">
                {configured && connected
                  ? 'WooCommerce connected'
                  : configured && needsReconnect
                    ? 'Reconnect required'
                    : 'No WooCommerce store connected'}
              </AlertTitle>
              <AlertDescription className="text-muted-foreground text-sm">
                {loadError ??
                  (connection?.message ??
                    (canEdit
                      ? 'Create REST API keys with Read access for orders, then connect below.'
                      : 'Ask a workspace admin to connect WooCommerce.'))}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {showConnectForm && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Store className="size-4" />
                {needsReconnect ? 'Reconnect store' : 'Connect store'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground">REST API setup</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>In WordPress admin, go to WooCommerce → Settings → Advanced → REST API.</li>
                  <li>Create keys with Read permissions for orders.</li>
                  <li>
                    Webhooks are registered automatically to:
                    {webhookUrl ? (
                      <code className="mt-1 block break-all rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground">
                        {webhookUrl}
                      </code>
                    ) : (
                      ' (shown after load on a public HTTPS domain)'
                    )}
                  </li>
                </ol>
              </div>

              <div className="space-y-2">
                <Label htmlFor="woo-store-url">Store URL</Label>
                <Input
                  id="woo-store-url"
                  value={storeUrl}
                  onChange={(e) => setStoreUrl(e.target.value)}
                  placeholder="https://your-store.com"
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="woo-consumer-key">Consumer key</Label>
                <Input
                  id="woo-consumer-key"
                  value={consumerKey}
                  onChange={(e) => setConsumerKey(e.target.value)}
                  placeholder="ck_..."
                  autoComplete="off"
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
                  autoComplete="new-password"
                />
              </div>

              <Button onClick={() => void handleConnect()} disabled={connecting}>
                {connecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    {needsReconnect ? 'Reconnect WooCommerce' : 'Connect WooCommerce'}
                    <ExternalLink className="ml-1.5 size-4" />
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        )}

        {configured && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {needsReconnect ? 'Previously connected store' : 'Connected store'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {connection?.store_name && (
                <p className="font-medium text-foreground">{connection.store_name}</p>
              )}
              {connection?.store_url && (
                <p className="text-muted-foreground">{connection.store_url}</p>
              )}
              {connection?.connected_at && (
                <p className="text-xs text-muted-foreground">
                  Connected{' '}
                  {new Date(connection.connected_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}
              {canEdit && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {connected && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={disconnecting}
                      onClick={() => void handleDisconnect()}
                    >
                      {disconnecting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          <Unlink className="mr-1.5 size-4" />
                          Disconnect
                        </>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
