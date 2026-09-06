'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { isEmbedMode, withEmbedQuery } from '@/lib/embed/query';
import { pickValidE164Phone } from '@/lib/whatsapp/phone-utils';
import type { Conversation } from '@/types';

/**
 * When `?phone=<E.164>` is present, find or create the conversation and
 * open it in the inbox. Cleans the URL on failure so refresh does not retry.
 */
export function usePhoneDeepLink() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const handledPhoneRef = useRef<string | null>(null);

  const phone = pickValidE164Phone(searchParams.getAll('phone'));
  const embedded = isEmbedMode(searchParams);
  const [pending, setPending] = useState(() => Boolean(phone));

  useEffect(() => {
    if (!phone) {
      setPending(false);
      return;
    }
    if (handledPhoneRef.current === phone) return;
    handledPhoneRef.current = phone;

    let cancelled = false;
    setPending(true);

    void (async () => {
      try {
        const res = await fetch('/api/inbox/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone }),
        });

        const data = (await res.json()) as Conversation & { error?: string };
        if (cancelled) return;

        if (!res.ok) {
          toast.error(data.error ?? 'Could not open chat');
          router.replace(withEmbedQuery(pathname, embedded), { scroll: false });
          setPending(false);
          return;
        }

        router.replace(
          withEmbedQuery(`/inbox?c=${data.id}`, embedded),
          { scroll: false },
        );
      } catch {
        if (cancelled) return;
        toast.error('Could not open chat');
        router.replace(withEmbedQuery(pathname, embedded), { scroll: false });
        setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phone, pathname, router, embedded]);

  return { phoneDeepLinkPending: pending && Boolean(phone) };
}
