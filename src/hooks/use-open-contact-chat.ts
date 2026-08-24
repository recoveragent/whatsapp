'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import type { Conversation } from '@/types';

interface ContactChatTarget {
  phone: string;
  name?: string | null;
}

export function useOpenContactChat() {
  const router = useRouter();
  const [opening, setOpening] = useState(false);

  const openChat = useCallback(
    async (contact: ContactChatTarget) => {
      const phone = contact.phone.trim();
      if (!phone) {
        toast.error('Contact has no phone number');
        return;
      }

      setOpening(true);
      try {
        const res = await fetch('/api/inbox/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phone,
            name: contact.name?.trim() || undefined,
          }),
        });

        const data = (await res.json()) as Conversation & { error?: string };
        if (!res.ok) {
          toast.error(data.error ?? 'Could not open chat');
          return;
        }

        router.push(`/inbox?c=${data.id}`);
      } catch {
        toast.error('Could not open chat');
      } finally {
        setOpening(false);
      }
    },
    [router],
  );

  return { openChat, opening };
}
