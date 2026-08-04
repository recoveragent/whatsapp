'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, Phone, Unlink, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';
import {
  normalizeWhatsAppConnectMode,
  type WhatsAppConnectMode,
} from '@/lib/whatsapp/connect-mode';
import { SettingsPanelHead } from './settings-panel-head';
import { WhatsAppConfig } from './whatsapp-config';
import { WhatsAppEmbeddedSignupPanel } from './whatsapp-embedded-signup-panel';
import { WhatsAppWebhookSetupCard } from './whatsapp-webhook-setup-card';

interface AccountContextPayload {
  linked?: boolean;
  needsBrandContext?: boolean;
  pendingInvite?: boolean;
  brandName?: string;
  accountId?: string;
  accountName?: string;
  canEditSettings?: boolean;
  isSuperAdminActing?: boolean;
  whatsappConnectMode?: WhatsAppConnectMode;
  message?: string;
  error?: string;
}

interface ConnectionPayload {
  configured: boolean;
  connected: boolean;
  needs_reconnect?: boolean;
  phone_number_id?: string | null;
  verified_name?: string | null;
  display_phone_number?: string | null;
  status?: string | null;
  registered?: boolean;
  registered_at?: string | null;
  last_registration_error?: string | null;
  message?: string;
  error?: string;
  needsBrandContext?: boolean;
}

export function WhatsAppBrandConnection() {
  const { isSuperAdmin, isSuperAdminActing } = useAuth();
  const [loading, setLoading] = useState(true);
  const [disconnecting, setDisconnecting] = useState(false);
  const [accountCtx, setAccountCtx] = useState<AccountContextPayload | null>(null);
  const [connection, setConnection] = useState<ConnectionPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

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
        setLoadError(
          ctx.message ??
            'Your account is not linked to a workspace yet. Sign in with your brand admin account, or accept your invite link first.',
        );
        return;
      }

      const res = await fetch('/api/whatsapp/connection', { cache: 'no-store' });
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
      console.error('[WhatsAppBrandConnection]', err);
      setConnection({ configured: false, connected: false });
      setLoadError(
        err instanceof Error ? err.message : 'Could not load WhatsApp connection status.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleDisconnect = async () => {
    if (
      !confirm(
        'Disconnect this WhatsApp number from the workspace? You can connect a different number afterward.',
      )
    ) {
      return;
    }

    setDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp/connection', { method: 'DELETE' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Disconnect failed');

      toast.success('WhatsApp disconnected. You can connect a new number now.');
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
          title="WhatsApp number"
          description="Connect your brand's WhatsApp Business number."
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
          title="WhatsApp number"
          description="Workspace settings require an active brand."
        />
        <Alert className="max-w-xl bg-card border-border">
          <AlertTitle className="text-foreground">Select a brand first</AlertTitle>
          <AlertDescription className="text-muted-foreground text-sm space-y-3">
            <p>
              As Recover Agent super admin, open a brand before using workspace
              settings like WhatsApp. Use <strong>WhatsApp setup</strong> under
              Brands for ops configuration, or open a brand to test the brand-admin
              view.
            </p>
            <Link
              href="/admin/brands"
              className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Go to Brands
            </Link>
          </AlertDescription>
        </Alert>
      </section>
    );
  }

  const connectMode = normalizeWhatsAppConnectMode(accountCtx?.whatsappConnectMode);
  const isSystemUserMode = connectMode === 'system_user_token';
  const canManageSystemUser =
    Boolean(accountCtx?.accountId) &&
    isSuperAdmin &&
    (Boolean(accountCtx?.isSuperAdminActing) || isSuperAdminActing);

  // Own Meta portfolio: Embedded Signup is blocked by Meta; ops paste
  // WABA / Phone Number ID / System User token instead.
  if (isSystemUserMode && canManageSystemUser && accountCtx?.accountId) {
    return (
      <WhatsAppConfig
        brandId={accountCtx.accountId}
        brandName={accountCtx.accountName}
        embeddedInSettings
      />
    );
  }

  if (isSystemUserMode) {
    const configured = connection?.configured ?? false;
    const connected = connection?.connected ?? false;
    const displayNumber =
      connection?.display_phone_number || connection?.phone_number_id || null;

    return (
      <section className="animate-in fade-in-50 duration-200">
        <SettingsPanelHead
          title="WhatsApp number"
          description="This workspace uses Recover Agent's own Meta portfolio credentials."
        />
        <div className="space-y-6 max-w-xl">
          <Alert className="bg-card border-border">
            <AlertTitle className="text-foreground mb-1">
              Connected via System User token
            </AlertTitle>
            <AlertDescription className="text-muted-foreground text-sm space-y-2">
              <p>
                Embedded Signup cannot select the business portfolio that owns
                Recover Agent WA. Credentials are managed by Recover Agent ops
                (WABA ID, Phone Number ID, permanent System User token).
              </p>
              {configured && connected && displayNumber ? (
                <p className="text-foreground">
                  Connected number: <strong>{displayNumber}</strong>
                  {connection?.verified_name
                    ? ` (${connection.verified_name})`
                    : ''}
                </p>
              ) : (
                <p>No number is connected yet. Contact Recover Agent to finish setup.</p>
              )}
            </AlertDescription>
          </Alert>
          {configured && connected && <WhatsAppWebhookSetupCard />}
        </div>
      </section>
    );
  }

  const configured = connection?.configured ?? false;
  const connected = connection?.connected ?? false;
  const needsReconnect = Boolean(
    connection?.needs_reconnect ?? (configured && !connected),
  );
  const canEditSettings = accountCtx?.canEditSettings ?? false;
  const displayNumber =
    connection?.display_phone_number || connection?.phone_number_id || null;
  const verifiedName = connection?.verified_name;
  const showConnect =
    canEditSettings &&
    Boolean(accountCtx?.linked) &&
    (!configured || needsReconnect);
  const registrationIncomplete =
    canEditSettings &&
    configured &&
    connected &&
    connection?.registered === false;

  return (
    <section className="animate-in fade-in-50 duration-200">
      <SettingsPanelHead
        title="WhatsApp number"
        description={
          configured && connected
            ? 'Your connected WhatsApp Business number for this workspace.'
            : configured && needsReconnect
              ? 'Reconnect or disconnect this number, then link a new WhatsApp Business number.'
              : 'Connect your Meta WhatsApp Business account and phone number.'
        }
      />

      <div className="space-y-6 max-w-xl">
        {(showConnect || registrationIncomplete) && (
          <WhatsAppEmbeddedSignupPanel
            onComplete={load}
            registrationOnly={registrationIncomplete}
          />
        )}

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
              <XCircle
                className={`size-5 mt-0.5 shrink-0 ${needsReconnect ? 'text-amber-400' : 'text-muted-foreground'}`}
              />
            )}
            <div>
              <AlertTitle className="text-foreground mb-1">
                {configured && connected
                  ? 'WhatsApp number connected'
                  : configured && needsReconnect
                    ? 'Number configured ù needs attention'
                    : 'No WhatsApp number connected'}
              </AlertTitle>
              <AlertDescription className="text-muted-foreground text-sm">
                {loadError ? (
                  loadError
                ) : configured && connected ? (
                  <>
                    Credentials are valid with Meta. Complete webhook setup below so
                    incoming messages appear in Inbox.
                  </>
                ) : configured && needsReconnect ? (
                  <>
                    {connection?.message ??
                      'A number is on file but Meta verification failed.'}
                    {canEditSettings
                      ? ' Use Connect with Meta above to link a new number, or Disconnect below to clear this one first.'
                      : ' Contact your workspace admin or Recover Agent.'}
                  </>
                ) : canEditSettings ? (
                  (connection?.message ??
                    'Use the Connect with Meta button above to link your WhatsApp Business number.')
                ) : (
                  connection?.message ??
                  'Ask a workspace admin to connect a WhatsApp Business number.'
                )}
              </AlertDescription>
            </div>
          </div>
        </Alert>

        {configured && connected && canEditSettings && <WhatsAppWebhookSetupCard />}

        {configured && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base text-foreground">
                <Phone className="size-4" />
                {needsReconnect ? 'Previously connected number' : 'Connected number'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {displayNumber && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Phone
                  </p>
                  <p className="mt-0.5 font-medium text-foreground">{displayNumber}</p>
                </div>
              )}
              {verifiedName && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Business name
                  </p>
                  <p className="mt-0.5 text-foreground">{verifiedName}</p>
                </div>
              )}
              {connection?.registered === false && connection.last_registration_error && (
                <p className="text-xs text-amber-200/90">
                  Registration note: {connection.last_registration_error}
                </p>
              )}
              {connection?.registered_at && (
                <p className="text-xs text-muted-foreground">
                  Registered{' '}
                  {new Date(connection.registered_at).toLocaleString(undefined, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </p>
              )}
              {canEditSettings && (
                <div className="pt-1">
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
