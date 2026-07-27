'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  RotateCcw,
  ShoppingBag,
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
  oauth_available?: boolean;
  has_app_credentials?: boolean;
  api_key_hint?: string | null;
  redirect_uri?: string | null;
  shop_domain?: string | null;
  shop_name?: string | null;
  connected_at?: string | null;
  message?: string;
  error?: string;
  needsBrandContext?: boolean;
}

export function ShopifyBrandConnection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthToastShown = useRef(false);
  const [loading, setLoading] = useState(true);
  const [accountCtx, setAccountCtx] = useState<AccountContextPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [shopInput, setShopInput] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
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

      const res = await fetch('/api/shopify/connection', { cache: 'no-store' });
      const data = (await res.json()) as ConnectionPayload;

      if (!res.ok) {
        if (data.needsBrandContext) {
          setConnection({ configured: false, connected: false, needsBrandContext: true });
          return;
        }
        throw new Error(data.error ?? 'Failed to load connection status');
      }

      setConnection(data);
      if (data.shop_domain) setShopInput(data.shop_domain.replace('.myshopify.com', ''));
      if (data.has_app_credentials) {
        setClientId('');
        setClientSecret('');
      }
    } catch (err) {
      setConnection({ configured: false, connected: false });
      setLoadError(err instanceof Error ? err.message : 'Could not load Shopify status.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (oauthToastShown.current) return;

    const connected = searchParams.get('shopify_connected');
    const error = searchParams.get('shopify_error');

    if (connected) {
      oauthToastShown.current = true;
      toast.success('Shopify store connected');
      void load();
      router.replace('/settings?tab=shopify', { scroll: false });
      return;
    }

    if (error) {
      oauthToastShown.current = true;
      toast.error(error);
      router.replace('/settings?tab=shopify', { scroll: false });
    }
  }, [searchParams, load, router]);

  const handleConnect = async (opts?: { useStoredCredentials?: boolean }) => {
    if (!shopInput.trim()) {
      toast.error('Enter your shop domain');
      return;
    }

    const preferStored = Boolean(
      opts?.useStoredCredentials ||
        (connection?.has_app_credentials && !clientId.trim() && !clientSecret.trim()),
    );

    if (!preferStored && !clientId.trim() && !connection?.has_app_credentials) {
      toast.error('Enter Client ID from your Shopify custom app');
      return;
    }
    if (!preferStored && !clientSecret.trim() && !connection?.has_app_credentials) {
      toast.error('Enter Client Secret from your Shopify custom app');
      return;
    }

    setConnecting(true);
    try {
      const body: Record<string, string> = { shop: shopInput.trim() };
      if (!preferStored) {
        if (clientId.trim()) body.client_id = clientId.trim();
        if (clientSecret.trim()) body.client_secret = clientSecret.trim();
      }

      const res = await fetch('/api/shopify/oauth/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { authorize_url?: string; error?: string };
      if (!res.ok || !data.authorize_url) {
        throw new Error(data.error ?? 'Could not start Shopify connection');
      }
      window.location.href = data.authorize_url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start Shopify connection');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect Shopify from this workspace? Campaign settings are kept, but order and checkout automations will stop until you reconnect.',
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch('/api/shopify/connection', { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Disconnect failed');

      toast.success('Shopify disconnected');
      setShopInput('');
      setClientId('');
      setClientSecret('');
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
          title="Shopify"
          description="Connect your store for order sync and Flows."
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
        <SettingsPanelHead title="Shopify" description="Workspace settings require an active brand." />
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
  const redirectUri = connection?.redirect_uri ?? '';

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="Shopify"
        description={
          configured
            ? 'Your connected Shopify store for order sync and Flows.'
            : 'Connect a custom Shopify app with Client ID and Secret for order sync and Flows.'
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
                  ? 'Shopify connected'
                  : configured && needsReconnect
                    ? 'Reconnect required'
                    : 'No Shopify store connected'}
              </AlertTitle>
              <AlertDescription className="text-muted-foreground text-sm">
                {loadError ??
                  (connection?.message ??
                    (configured && connected
                      ? 'Webhooks are registered. Enable campaigns below to start sending messages.'
                      : canEdit
                        ? 'Create a custom app in the client’s Shopify Dev Dashboard, then enter Client ID, Client Secret, and shop domain.'
                        : 'Ask a workspace admin to connect Shopify.'))}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {showConnectForm && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShoppingBag className="size-4" />
                {needsReconnect ? 'Reconnect store' : 'Connect store'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground">Custom app setup</p>
                <ol className="list-decimal pl-4 space-y-1">
                  <li>In Shopify Dev Dashboard, create a custom app for this store.</li>
                  <li>
                    Add Allowed redirection URL:
                    {redirectUri ? (
                      <code className="mt-1 block break-all rounded bg-background px-1.5 py-0.5 text-[11px] text-foreground">
                        {redirectUri}
                      </code>
                    ) : (
                      ' (shown after load)'
                    )}
                  </li>
                  <li>Enable Admin API scopes for orders, fulfillments, checkouts, and customers.</li>
                  <li>Paste Client ID and Client Secret below, then connect.</li>
                </ol>
              </div>

              <div className="space-y-2">
                <Label htmlFor="shop-domain">Shop domain</Label>
                <div className="flex gap-2">
                  <Input
                    id="shop-domain"
                    value={shopInput}
                    onChange={(e) => setShopInput(e.target.value)}
                    placeholder="your-store"
                    className="flex-1"
                    autoComplete="off"
                  />
                  <span className="flex items-center text-sm text-muted-foreground">
                    .myshopify.com
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="shopify-client-id">Client ID</Label>
                <Input
                  id="shopify-client-id"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={
                    connection?.api_key_hint
                      ? `Stored: ${connection.api_key_hint}`
                      : 'From Shopify custom app'
                  }
                  autoComplete="off"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="shopify-client-secret">Client Secret</Label>
                <Input
                  id="shopify-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder={
                    connection?.has_app_credentials
                      ? 'Leave blank to reuse stored secret'
                      : 'From Shopify custom app'
                  }
                  autoComplete="new-password"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => void handleConnect()}
                  disabled={connecting}
                >
                  {connecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <>
                      {needsReconnect ? 'Reconnect with Shopify' : 'Connect with Shopify'}
                      <ExternalLink className="ml-1.5 size-4" />
                    </>
                  )}
                </Button>
                {configured && needsReconnect && (
                  <Button
                    type="button"
                    variant="outline"
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
              {connection?.shop_name && (
                <p className="font-medium text-foreground">{connection.shop_name}</p>
              )}
              {connection?.shop_domain && (
                <p className="text-muted-foreground">{connection.shop_domain}</p>
              )}
              {connection?.api_key_hint && (
                <p className="text-xs text-muted-foreground">
                  Custom app Client ID {connection.api_key_hint}
                </p>
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
              {canEdit && connected && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={connecting}
                    onClick={() => void handleConnect({ useStoredCredentials: true })}
                  >
                    {connecting ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <>
                        <RotateCcw className="mr-1.5 size-4" />
                        Reconnect
                      </>
                    )}
                  </Button>
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
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </section>
  );
}
