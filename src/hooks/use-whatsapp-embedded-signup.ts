'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import type {
  EmbeddedSignupSession,
  FacebookLoginResponse,
} from '@/lib/whatsapp/facebook-sdk-types';

const FB_SDK_URL = 'https://connect.facebook.net/en_US/sdk.js';
const FB_API_VERSION = 'v21.0';

function isFacebookOrigin(origin: string): boolean {
  return (
    origin === 'https://www.facebook.com' ||
    origin === 'https://web.facebook.com' ||
    origin.endsWith('.facebook.com')
  );
}

function loadFacebookSdk(appId: string): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Facebook SDK requires a browser'));
  }

  if (window.FB) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const existing = document.getElementById('facebook-jssdk');
    if (existing) {
      const check = () => {
        if (window.FB) resolve();
        else setTimeout(check, 50);
      };
      check();
      return;
    }

    window.fbAsyncInit = () => {
      window.FB?.init({
        appId,
        cookie: true,
        xfbml: false,
        version: FB_API_VERSION,
      });
      resolve();
    };

    const script = document.createElement('script');
    script.id = 'facebook-jssdk';
    script.src = FB_SDK_URL;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error('Failed to load Facebook SDK'));
    document.body.appendChild(script);
  });
}

interface EmbeddedSignupConfig {
  enabled: boolean;
  appId?: string;
  configId?: string;
}

export function useWhatsAppEmbeddedSignup({
  onComplete,
}: {
  onComplete: () => void | Promise<void>;
}) {
  const [config, setConfig] = useState<EmbeddedSignupConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [sdkReady, setSdkReady] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [pin, setPin] = useState('');
  const [needsPin, setNeedsPin] = useState(false);

  const pendingRef = useRef<{
    code?: string;
    waba_id?: string;
    phone_number_id?: string;
  }>({});

  const completeSignup = useCallback(async () => {
      const { code, waba_id, phone_number_id } = pendingRef.current;
      if (!code || !waba_id || !phone_number_id) {
        return 'noop' as const;
      }

      const res = await fetch('/api/whatsapp/embedded-signup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          waba_id,
          phone_number_id,
          pin: null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error ?? 'Failed to complete WhatsApp connection');
      }

      if (data.registration_error) {
        setNeedsPin(true);
        pendingRef.current = {};
        await onComplete();
        return 'needs_pin' as const;
      }

      pendingRef.current = {};
      setPin('');
      setNeedsPin(false);
      await onComplete();
      return 'success' as const;
    },
    [onComplete],
  );

  const tryComplete = useCallback(async () => {
    const { code, waba_id, phone_number_id } = pendingRef.current;
    if (!code || !waba_id || !phone_number_id) return;

    try {
      const result = await completeSignup();
      if (result === 'success') {
        toast.success('WhatsApp number connected successfully.');
      } else if (result === 'needs_pin') {
        toast.message(
          'Credentials saved. Enter your two-step PIN below to enable inbound messages.',
          { duration: 8000 },
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not finish connecting WhatsApp';
      toast.error(message, { duration: 10000 });
    } finally {
      setLaunching(false);
    }
  }, [completeSignup]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConfigLoading(true);
      try {
        const res = await fetch('/api/whatsapp/embedded-signup/config', {
          cache: 'no-store',
        });
        const data = (await res.json()) as EmbeddedSignupConfig;
        if (!cancelled) setConfig(data);
      } catch {
        if (!cancelled) setConfig({ enabled: false });
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!config?.enabled || !config.appId) return;
    let cancelled = false;
    loadFacebookSdk(config.appId)
      .then(() => {
        if (!cancelled) setSdkReady(true);
      })
      .catch((err) => {
        console.error('[embedded-signup] SDK load failed:', err);
        if (!cancelled) setSdkReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [config?.enabled, config?.appId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!isFacebookOrigin(event.origin)) return;
      try {
        const data = JSON.parse(event.data as string) as {
          type?: string;
          event?: string;
          data?: EmbeddedSignupSession & { current_step?: string };
        };

        if (data.type !== 'WA_EMBEDDED_SIGNUP') return;

        if (data.event === 'FINISH' && data.data?.waba_id && data.data?.phone_number_id) {
          pendingRef.current.waba_id = data.data.waba_id;
          pendingRef.current.phone_number_id = data.data.phone_number_id;
          void tryComplete();
        } else if (data.event === 'CANCEL') {
          setLaunching(false);
          toast.message('WhatsApp connection cancelled');
        }
      } catch {
        // Non-JSON postMessage — ignore
      }
    };

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [tryComplete]);

  const launch = useCallback(() => {
    if (!config?.enabled || !config.configId || !window.FB) {
      toast.error('WhatsApp Embedded Signup is not available');
      return;
    }

    setLaunching(true);
    pendingRef.current = {};

    window.FB.login(
      (response: FacebookLoginResponse) => {
        if (response.authResponse?.code) {
          pendingRef.current.code = response.authResponse.code;
          void tryComplete();
        } else {
          setLaunching(false);
          if (response.status !== 'unknown') {
            toast.message('WhatsApp connection was not completed');
          }
        }
      },
      {
        config_id: config.configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
          feature: 'whatsapp_embedded_signup',
        },
      },
    );
  }, [config, tryComplete]);

  const retryWithPin = useCallback(async () => {
    if (!/^\d{6}$/.test(pin)) {
      toast.error('Enter the 6-digit two-step verification PIN from Meta');
      return;
    }
    setLaunching(true);
    try {
      const res = await fetch('/api/whatsapp/embedded-signup/retry-registration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? 'Registration retry failed');
      }
      setNeedsPin(false);
      setPin('');
      toast.success('WhatsApp number registered for inbound messages.');
      await onComplete();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Registration retry failed',
        { duration: 10000 },
      );
    } finally {
      setLaunching(false);
    }
  }, [onComplete, pin]);

  return {
    configLoading,
    enabled: Boolean(config?.enabled),
    sdkReady,
    launching,
    launch,
    needsPin,
    pin,
    setPin,
    retryWithPin,
    hasPendingSession: Boolean(
      pendingRef.current.code &&
        pendingRef.current.waba_id &&
        pendingRef.current.phone_number_id,
    ),
  };
}
