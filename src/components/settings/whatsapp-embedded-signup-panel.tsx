'use client';

import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useWhatsAppEmbeddedSignup } from '@/hooks/use-whatsapp-embedded-signup';

export function WhatsAppEmbeddedSignupPanel({
  onComplete,
  registrationOnly = false,
}: {
  onComplete: () => void | Promise<void>;
  /** Credentials saved but inbound /register still needs a PIN. */
  registrationOnly?: boolean;
}) {
  const {
    configLoading,
    enabled,
    sdkReady,
    launching,
    launch,
    needsPin,
    pin,
    setPin,
    retryWithPin,
  } = useWhatsAppEmbeddedSignup({ onComplete });

  if (configLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Checking Meta connection options…
      </div>
    );
  }

  if (!enabled && !registrationOnly) {
    return (
      <p className="text-sm text-muted-foreground">
        Self-service Meta connection is not enabled yet. Contact Recover Agent to
        connect your WhatsApp Business number, or ask ops to finish setup in the
        admin console.
      </p>
    );
  }

  const showConnect = !registrationOnly && !needsPin;
  const showPin = registrationOnly || needsPin;

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4">
      {showConnect && (
        <div>
          <p className="font-medium text-foreground">Connect with Meta</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Sign in with your Meta Business account, select or create a WhatsApp
            Business account, and verify your phone number. Recover Agent never sees
            your Meta password.
          </p>
        </div>
      )}

      {showConnect && (
        <Button
          type="button"
          onClick={launch}
          disabled={!sdkReady || launching}
          className="bg-[#1877F2] hover:bg-[#166FE5] text-white"
        >
          {launching ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Connecting…
            </>
          ) : (
            'Connect WhatsApp with Meta'
          )}
        </Button>
      )}

      {showPin && (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="text-sm text-muted-foreground">
            Your number needs the two-step verification PIN from Meta WhatsApp
            Manager to receive inbound messages.
          </p>
          <div className="space-y-2 max-w-xs">
            <Label htmlFor="wa-embedded-pin">Two-step verification PIN</Label>
            <Input
              id="wa-embedded-pin"
              inputMode="numeric"
              maxLength={6}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="6-digit PIN"
              className="tracking-widest"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={retryWithPin}
            disabled={launching || pin.length !== 6}
          >
            {launching ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              'Complete registration'
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
