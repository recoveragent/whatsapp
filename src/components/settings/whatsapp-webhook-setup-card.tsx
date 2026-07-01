'use client';

import { useCallback, useEffect, useState } from 'react';
import { Copy, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface WebhookSetup {
  callbackUrl: string;
  verifyToken: string | null;
  isLocalhost: boolean;
  registered: boolean;
  note: string | null;
}

export function WhatsAppWebhookSetupCard() {
  const [loading, setLoading] = useState(true);
  const [setup, setSetup] = useState<WebhookSetup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/whatsapp/webhook-setup', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load webhook setup');
      setSetup(data);
    } catch (err) {
      console.error('[WhatsAppWebhookSetupCard]', err);
      setSetup(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function copy(value: string, label: string) {
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading webhook setup…
      </div>
    );
  }

  if (!setup) return null;

  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-base text-foreground">Inbound messages (webhook)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-muted-foreground leading-relaxed">
          Settings shows your number is valid with Meta. Messages only appear in Inbox
          after Meta can POST to your webhook URL. Configure this once in{' '}
          <strong className="text-foreground">Meta → WhatsApp → Configuration</strong>.
        </p>

        {setup.isLocalhost && (
          <Alert className="bg-amber-950/30 border-amber-700/50">
            <AlertTitle className="text-amber-200 text-sm">Local development</AlertTitle>
            <AlertDescription className="text-amber-100/80 text-xs leading-relaxed">
              Meta cannot reach <code className="text-amber-100">localhost</code>. Run{' '}
              <code className="text-amber-100">ngrok http 3000</code>, then use your ngrok
              HTTPS URL below (e.g.{' '}
              <code className="text-amber-100">https://abc.ngrok.io/api/whatsapp/webhook</code>
              ).
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label className="text-muted-foreground">Callback URL</Label>
          <div className="flex gap-2">
            <Input readOnly value={setup.callbackUrl} className="font-mono text-xs" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => copy(setup.callbackUrl, 'Callback URL')}
            >
              <Copy className="size-4" />
            </Button>
          </div>
        </div>

        {setup.verifyToken && (
          <div className="space-y-2">
            <Label className="text-muted-foreground">Verify token</Label>
            <div className="flex gap-2">
              <Input readOnly value={setup.verifyToken} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => copy(setup.verifyToken!, 'Verify token')}
              >
                <Copy className="size-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Paste the same verify token in Meta when saving the webhook.
            </p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Subscribe to the <strong className="text-foreground">messages</strong> field.
          {!setup.registered && (
            <>
              {' '}
              This number may also need inbound registration (two-step PIN) — see above if
              registration is incomplete.
            </>
          )}
        </p>
      </CardContent>
    </Card>
  );
}
