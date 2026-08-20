'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  CheckCircle2,
  ExternalLink,
  FileSpreadsheet,
  Loader2,
  Unlink,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { LeadSourcesPanel } from './lead-sources-panel';

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
  oauth_available?: boolean;
  redirect_uri?: string | null;
  google_email?: string | null;
  connected_at?: string | null;
  message?: string;
  error?: string;
  needsBrandContext?: boolean;
}

export function GoogleSheetsBrandConnection() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthToastShown = useRef(false);
  const [loading, setLoading] = useState(true);
  const [accountCtx, setAccountCtx] = useState<AccountContextPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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

      const res = await fetch('/api/google-sheets/connection', { cache: 'no-store' });
      const data = (await res.json()) as ConnectionPayload;

      if (!res.ok) {
        if (data.needsBrandContext) {
          setConnection({ configured: false, connected: false, needsBrandContext: true });
          return;
        }
        throw new Error(data.error ?? 'Failed to load connection status');
      }

      setConnection(data);
    } catch (err) {
      setConnection({ configured: false, connected: false });
      setLoadError(
        err instanceof Error ? err.message : 'Could not load Google Sheets status.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (oauthToastShown.current) return;

    const connected = searchParams.get('google_sheets_connected');
    const error = searchParams.get('google_sheets_error');

    if (connected) {
      oauthToastShown.current = true;
      toast.success('Google Sheets connected');
      void load();
      router.replace('/settings?tab=google_sheets', { scroll: false });
      return;
    }

    if (error) {
      oauthToastShown.current = true;
      toast.error(error);
      router.replace('/settings?tab=google_sheets', { scroll: false });
    }
  }, [searchParams, load, router]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const res = await fetch('/api/google-sheets/oauth/start', { method: 'POST' });
      const data = (await res.json()) as { authorize_url?: string; error?: string };
      if (!res.ok || !data.authorize_url) {
        throw new Error(data.error ?? 'Could not start Google connection');
      }
      window.location.href = data.authorize_url;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not start Google connection');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect Google Sheets from this workspace? Sheet-triggered flows will stop until you reconnect.',
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch('/api/google-sheets/connection', { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Disconnect failed');

      toast.success('Google Sheets disconnected');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Disconnect failed');
    } finally {
      setDisconnecting(false);
    }
  };

  const canEdit = accountCtx?.canEditSettings !== false;
  const needsBrand = connection?.needsBrandContext;

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Google Sheets"
        description="One Google login. Add each Instant Form spreadsheet as a campaign below — new rows enroll in a follow-up cadence."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading…
        </div>
      ) : loadError ? (
        <Alert variant="destructive">
          <XCircle className="size-4" />
          <AlertTitle>Could not load</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      ) : needsBrand ? (
        <Alert>
          <AlertTitle>Open a brand first</AlertTitle>
          <AlertDescription>
            Switch into a brand workspace, then connect Google Sheets.
          </AlertDescription>
        </Alert>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="size-4" />
                Connection
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {connection?.message ??
                  'Authorize read-only access to spreadsheets you own or can open.'}
              </p>
            </div>
            {connection?.connected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-3.5" />
                Connected
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Not connected
              </span>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {connection?.connected && connection.google_email && (
              <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                <span className="text-muted-foreground">Google account · </span>
                <span className="font-medium">{connection.google_email}</span>
              </div>
            )}

            {connection?.redirect_uri && (
              <p className="text-[11px] text-muted-foreground">
                OAuth redirect URI (add this in Google Cloud Console):{' '}
                <code className="break-all rounded bg-muted px-1 py-0.5">
                  {connection.redirect_uri}
                </code>
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button
                  type="button"
                  disabled={connecting || connection?.oauth_available === false}
                  onClick={() => void handleConnect()}
                >
                  {connecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <ExternalLink className="size-4" />
                  )}
                  <span className="ml-1.5">
                    {connection?.connected ? 'Reconnect Google' : 'Connect Google'}
                  </span>
                </Button>
              )}
              {canEdit && connection?.configured && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={disconnecting}
                  onClick={() => void handleDisconnect()}
                >
                  {disconnecting ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Unlink className="size-4" />
                  )}
                  <span className="ml-1.5">Disconnect</span>
                </Button>
              )}
            </div>

            {connection?.oauth_available === false && (
              <Alert>
                <AlertTitle>Server setup required</AlertTitle>
                <AlertDescription>
                  Set <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code>{' '}
                  on the host, then redeploy.
                </AlertDescription>
              </Alert>
            )}

            <p className="text-xs text-muted-foreground">
              Instant Form dumps belong below as campaign sheets — they enroll
              silent leads into a cadence. Flows with a Google Sheet trigger
              are still available for chat graphs.{' '}
              <Link href="/settings?tab=cadences" className="underline underline-offset-2">
                Edit cadences
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      {connection?.connected ? (
        <div className="mt-6">
          <LeadSourcesPanel googleConnected={connection.connected} />
        </div>
      ) : null}
    </div>
  );
}
