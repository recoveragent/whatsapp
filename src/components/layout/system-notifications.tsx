'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import type { Notification } from '@/types';
import { alertCode, groupDeliveryAlerts, metaPaymentMessage, paymentIssueUrl } from '@/lib/whatsapp/delivery-alerts';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function SystemNotifications() {
  const { accountId, user } = useAuth();
  return accountId && user ? (
    <DeliveryNotifications key={`${accountId}-${user.id}`} accountId={accountId} userId={user.id} />
  ) : null;
}

function DeliveryNotifications({ accountId, userId }: { accountId: string; userId: string }) {
  const [alerts, setAlerts] = useState<Notification[]>([]);
  const [count, setCount] = useState(0);
  const [error, setError] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const load = useCallback(
    async (isCurrent: () => boolean = () => true) => {
      if (!accountId) return;
      const {
        data,
        error: queryError,
      } = await createClient()
        .from('notifications')
        .select('*')
        .eq('account_id', accountId)
        .in('type', ['message_failed', 'whatsapp_disconnected'])
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .gte('created_at', new Date(Date.now() - 30 * 86400_000).toISOString())
        .limit(1000);
      if (!isCurrent()) return;
      setError(!!queryError);
      if (!queryError) {
        setAlerts(data ?? []);
        setCount(groupDeliveryAlerts(data ?? []).length);
        if ((data ?? []).some((item: Notification) => alertCode(item) === '131042') &&
            !sessionStorage.getItem(`payment-alert-${accountId}-${userId}`)) {
          setPaymentOpen(true);
          sessionStorage.setItem(`payment-alert-${accountId}-${userId}`, 'shown');
        }
      }
    },
    [accountId, userId]
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
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const alert = payload.new as Notification;
            if (
              alert.type === 'message_failed' ||
              alert.type === 'whatsapp_disconnected'
            ) {
              toast.error(alertCode(alert) === '131042' ? 'Meta payment issue' : alert.title, {
                id: `delivery-${accountId}-${alertCode(alert) ?? alert.type}`,
                description: 'Open delivery alerts to review affected messages.',
                duration: 10000,
              });
            }
          }
          refresh();
        }
      )
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [accountId, load]);

  const groups = groupDeliveryAlerts(alerts);
  const paymentAlert = alerts.find((alert) => alertCode(alert) === '131042' && paymentIssueUrl(alert)) ?? alerts.find((alert) => alertCode(alert) === '131042');
  const paymentUrl = paymentAlert ? paymentIssueUrl(paymentAlert) : null;

  return (<>
    <Dialog open={paymentOpen && !!paymentAlert} onOpenChange={setPaymentOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Meta payment issue</DialogTitle>
          <DialogDescription>Meta reported an issue that may prevent WhatsApp messages from being delivered.</DialogDescription>
        </DialogHeader>
        <div className="bg-muted rounded-lg p-3 text-sm break-words">
          <p className="mb-1 text-xs font-semibold">Message from Meta</p>
          <p>{paymentAlert && metaPaymentMessage(paymentAlert)}</p>
        </div>
        {paymentUrl && <a href={paymentUrl} target="_blank" rel="noopener noreferrer" className="bg-primary text-primary-foreground rounded-md p-3 text-center text-sm font-semibold">Resolve payment issue</a>}
        <Link href="/notifications" onClick={() => setPaymentOpen(false)} className="rounded-md border p-3 text-center text-sm font-medium">View affected messages</Link>
      </DialogContent>
    </Dialog>
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
            groups.map(([code, group]) => {
              const alert = group[0];
              if (code === '131042') return (
                <button key={code} type="button" onClick={() => setPaymentOpen(true)} className="hover:bg-muted block w-full border-b p-3 text-left">
                  <p className="text-sm font-medium">Meta payment issue</p>
                  <p className="text-muted-foreground mt-1 text-xs">{group.length} {group.length === 1 ? 'alert' : 'alerts'} · {new Set(group.map((item) => item.conversation_id).filter(Boolean)).size} conversations</p>
                </button>
              );
              return (
              <Link
                key={code}
                href={
                  alert.type === 'whatsapp_disconnected'
                    ? '/settings?tab=whatsapp'
                    : group.length === 1 && alert.conversation_id
                      ? `/inbox?c=${alert.conversation_id}`
                      : '/notifications'
                }
                onClick={() => {
                  if (group.length === 1) void createClient().from('notifications')
                    .update({ read_at: new Date().toISOString() }).eq('id', alert.id)
                    .then(() => load());
                }}
                className="hover:bg-muted block border-b p-3"
              >
                <p className="text-sm font-medium">{code === '131042' ? 'Meta payment issue' : alert.title}</p>
                <p className="text-muted-foreground mt-1 text-xs break-words">
                  {group.length} {group.length === 1 ? 'alert' : 'alerts'} · {new Set(group.map((item) => item.conversation_id).filter(Boolean)).size} conversations
                </p>
              </Link>
            )})
          )}
        </div>
        <Link
          href="/notifications"
          className="text-primary block p-3 text-center text-xs font-medium"
        >
          View all notifications
        </Link>
      </PopoverContent>
    </Popover></>
  );
}
