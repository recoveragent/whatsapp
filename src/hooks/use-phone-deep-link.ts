'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';

import { buildEmbedInboxUrl, isEmbedMode } from '@/lib/embed/query';
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
  const prevPhoneRef = useRef<string | null>(null);

  const phone = pickValidE164Phone(searchParams.getAll('phone'));
  const conversationId = searchParams.get('c');
  const embedded = isEmbedMode(searchParams);
  // `pending` only matters while there is a phone and no conversation
  // yet (see the return value), so seeding it from `phone` alone is fine.
  const [pending, setPending] = useState(() => Boolean(phone));

  // Sync `pending` with the URL during render rather than in effects,
  // to avoid cascading renders. A new phone starts a lookup (the effect
  // below); a conversation id in the URL means there is nothing to wait for.
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  if (conversationId !== prevConversationId) {
    setPrevConversationId(conversationId);
    if (conversationId) setPending(false);
  }
  const [prevPhone, setPrevPhone] = useState(phone);
  if (phone !== prevPhone) {
    setPrevPhone(phone);
    setPending(Boolean(phone));
  }

  useEffect(() => {
    if (phone !== prevPhoneRef.current) {
      handledPhoneRef.current = null;
      prevPhoneRef.current = phone;
    }
  }, [phone]);

  useEffect(() => {
    if (!phone) return;
    if (handledPhoneRef.current === phone) return;
    handledPhoneRef.current = phone;

    let cancelled = false;

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
          router.replace(
            embedded && phone
              ? buildEmbedInboxUrl({ phone })
              : pathname,
            { scroll: false },
          );
          setPending(false);
          return;
        }

        router.replace(
          embedded
            ? buildEmbedInboxUrl({ phone, conversationId: data.id })
            : `/inbox?c=${data.id}`,
          { scroll: false },
        );
        setPending(false);
      } catch {
        if (cancelled) return;
        toast.error('Could not open chat');
        router.replace(
          embedded && phone
            ? buildEmbedInboxUrl({ phone })
            : pathname,
          { scroll: false },
        );
        setPending(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phone, pathname, router, embedded]);

  return {
    phoneDeepLinkPending: pending && Boolean(phone) && !conversationId,
  };
}
