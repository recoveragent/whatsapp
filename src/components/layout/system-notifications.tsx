'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Notification } from '@/types';

export function SystemNotifications() {
  const { accountId } = useAuth();
  return accountId ? (
    <DeliveryNotifications key={accountId} accountId={accountId} />
  ) : null;
}

function DeliveryNotifications({ accountId }: { accountId: string }) {
  const [alerts, setAlerts] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(false);
  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!accountId) return;
      const {
        data,
        count: unread,
        error: queryError,
      } = await createClient()
        .from('notifications')
        .select('*', { count: 'exact' })
        .eq('account_id', accountId)
        .in('type', ['message_failed', 'whatsapp_disconnected'])
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(10);
      if (!isCurrent()) return;
      setError(!!queryError);
      if (!queryError) {
        setAlerts(data ?? []);
        setCount(unread ?? 0);
      }
    },
    [accountId]
  );

  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (active) void load(() => active);
    };
    refresh();
    const timer = window.setInterval(refresh, 30_000);
    const client = createClient();
    const channel = client
      .channel(`header-alerts-${accountId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'notifications',
          filter: `account_id=eq.${accountId}`,
        },
        refresh
      )
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [accountId, load]);

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Delivery alerts${count ? `, ${count} unread` : ''}`}
        onClick={() => void load()}
        className="text-muted-foreground hover:bg-accent relative flex h-10 w-10 items-center justify-center rounded-full"
      >
        <TriangleAlert className="h-[18px] w-[18px]" />
        {count > 0 && (
          <span className="bg-destructive absolute -top-0.5 -right-0.5 rounded-full px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(100vw-2rem,24rem)] p-0">
        <div className="border-b p-3">
          <p className="text-sm font-semibold">Delivery alerts</p>
          <p className="text-muted-foreground text-xs">
            WhatsApp messages and connection issues that need attention
          </p>
        </div>
        <div className="max-h-80 overflow-y-auto">
          {error ? (
            <p role="alert" className="p-3 text-xs">
              Could not load notifications.{' '}
              <button onClick={() => void load()} className="underline">
                Retry
              </button>
            </p>
          ) : alerts.length === 0 ? (
            <p className="text-muted-foreground p-4 text-xs">
              No unread delivery alerts
            </p>
          ) : (
            alerts.map((alert) => (
              <Link
                key={alert.id}
                href={
                  alert.type === 'whatsapp_disconnected'
                    ? '/settings?tab=whatsapp'
                    : alert.conversation_id
                      ? `/inbox?c=${alert.conversation_id}`
                      : '/notifications'
                }
                onClick={() => {
                  void createClient().from('notifications')
                    .update({ read_at: new Date().toISOString() }).eq('id', alert.id)
                    .then(() => load());
                }}
                className="hover:bg-muted block border-b p-3"
              >
                <p className="text-sm font-medium">{alert.title}</p>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {alert.body}
                </p>
              </Link>
            ))
          )}
        </div>
        <Link
          href="/notifications"
          className="text-primary block p-3 text-center text-xs font-medium"
        >
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  );
}
