'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { formatDistanceToNow } from 'date-fns';
import { alertCode, alertContact, describeAlertGroup, groupDeliveryAlerts, metaPaymentMessage, paymentIssueUrl, plural, type AlertSeverity, type DeliveryAlertGroup } from '@/lib/whatsapp/delivery-alerts';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
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
  const dismissedPaymentIds = useRef<Set<string> | null>(null);
  const paymentStorageKey = `payment-alert-dismissed-${accountId}-${userId}`;
  const getDismissedPaymentIds = useCallback(() => {
    if (dismissedPaymentIds.current === null) {
      try {
        const saved: unknown = JSON.parse(localStorage.getItem(paymentStorageKey) ?? '[]');
        dismissedPaymentIds.current = new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []);
      } catch { dismissedPaymentIds.current = new Set(); }
    }
    return dismissedPaymentIds.current;
  }, [paymentStorageKey]);
  // Per-viewer preference: grouped by category (default) or one row per alert.
  const [grouped, setGrouped] = useState(true);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(GROUPED_KEY) === 'off') setGrouped(false);
    } catch { /* Storage unavailable; keep the default. */ }
  }, []);
  const changeGrouped = (on: boolean) => {
    setGrouped(on);
    try { localStorage.setItem(GROUPED_KEY, on ? 'on' : 'off'); } catch { /* ignore */ }
  };
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
        setCount((data ?? []).length);
        const dismissed = getDismissedPaymentIds();
        if ((data ?? []).some((item: Notification) => alertCode(item) === '131042' && !dismissed.has(item.id))) {
          setPaymentOpen(true);
        }
      }
    },
    [accountId, getDismissedPaymentIds]
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
              toast.error(alert.type === 'whatsapp_disconnected' ? alert.title : describeAlertGroup(alertCode(alert) ?? 'other', [alert]).title, {
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
  const markRead = async (ids: string[]) => {
    const now = new Date().toISOString();
    setAlerts((prev) => prev.filter((item) => !ids.includes(item.id)));
    setCount((prev) => Math.max(0, prev - ids.length));
    const client = createClient();
    // Chunk so a large group does not exceed the request URL limit.
    for (let i = 0; i < ids.length; i += 100) {
      const { error: updateError } = await client.from('notifications')
        .update({ read_at: now }).in('id', ids.slice(i, i + 100)).is('read_at', null);
      if (updateError) { toast.error('Could not mark alerts as read'); return; }
    }
  };
  const paymentAlert = alerts.find((alert) => alertCode(alert) === '131042' && paymentIssueUrl(alert)) ?? alerts.find((alert) => alertCode(alert) === '131042');
  const paymentUrl = paymentAlert ? paymentIssueUrl(paymentAlert) : null;
  const changePaymentOpen = (open: boolean) => {
    if (!open) {
      const dismissed = getDismissedPaymentIds();
      for (const alert of alerts) {
        if (alertCode(alert) === '131042') dismissed.add(alert.id);
      }
      try { localStorage.setItem(paymentStorageKey, JSON.stringify([...dismissed])); } catch { /* Keep the dismissal in memory. */ }
    }
    setPaymentOpen(open);
  };

  return (<>
    <Dialog open={paymentOpen && !!paymentAlert} onOpenChange={changePaymentOpen}>
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
        <Link href="/notifications?code=131042" onClick={() => changePaymentOpen(false)} className="rounded-md border p-3 text-center text-sm font-medium">View affected messages</Link>
      </DialogContent>
    </Dialog>
    <Popover>
      <PopoverTrigger
        aria-label={`Delivery alerts${count ? `, ${plural(count, 'unread alert')} in ${plural(groups.length, 'group')}` : ''}`}
        title={count ? `${plural(count, 'unread alert')} in ${plural(groups.length, 'group')}` : 'Delivery alerts'}
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
            {count
              ? `${plural(count, 'unread alert')}${grouped ? ` in ${plural(groups.length, 'group')}` : ''}, newest first`
              : 'WhatsApp messages and connection issues that need attention'}
          </p>
          <label className="mt-2 flex cursor-pointer items-center justify-between gap-2 text-xs">
            <span>Show by category</span>
            <Switch checked={grouped} onCheckedChange={changeGrouped} aria-label="Show alerts by category" />
          </label>
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
          ) : grouped ? (
            groups.map((group) => (
              <AlertGroupRow
                key={group.key}
                group={group}
                onOpenPayment={() => setPaymentOpen(true)}
                onMarkRead={() => void markRead(group.alerts.map((item) => item.id)).then(() => load())}
              />
            ))
          ) : (
            <>
              {alerts.slice(0, INDIVIDUAL_LIMIT).map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  onOpenPayment={() => setPaymentOpen(true)}
                  onMarkRead={() => void markRead([alert.id]).then(() => load())}
                />
              ))}
              {alerts.length > INDIVIDUAL_LIMIT && (
                <p className="text-muted-foreground p-3 text-center text-[11px]">
                  Showing the {INDIVIDUAL_LIMIT} newest of {alerts.length} alerts
                </p>
              )}
            </>
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

const GROUPED_KEY = 'delivery-alerts-grouped';
const INDIVIDUAL_LIMIT = 50;

const SEVERITY_STYLE: Record<AlertSeverity, { dot: string; label: string }> = {
  critical: { dot: 'bg-destructive', label: 'Blocks sending' },
  action: { dot: 'bg-amber-500', label: 'Needs a fix' },
  temporary: { dot: 'bg-sky-500', label: 'Temporary' },
  recipient: { dot: 'bg-muted-foreground/50', label: 'Recipient side' },
};

function groupHref(group: DeliveryAlertGroup): string {
  const first = group.alerts[0];
  if (group.key === 'connection') return '/settings?tab=whatsapp';
  if (group.alerts.length === 1 && first.conversation_id) return `/inbox?c=${first.conversation_id}`;
  return `/notifications?code=${encodeURIComponent(group.key)}`;
}

function AlertGroupRow({ group, onOpenPayment, onMarkRead }: {
  group: DeliveryAlertGroup;
  onOpenPayment: () => void;
  onMarkRead: () => void;
}) {
  const style = SEVERITY_STYLE[group.severity];
  const body = (
    <>
      <div className="flex items-start gap-2">
        <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', style.dot)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium break-words">{group.title}</p>
          <p className="text-muted-foreground mt-0.5 text-xs break-words">{group.hint}</p>
          <p className="text-muted-foreground mt-1 text-[11px]">
            {style.label} · {plural(group.alerts.length, 'alert')} · {plural(group.conversations, 'conversation')} · latest{' '}
            {formatDistanceToNow(new Date(group.latestAt), { addSuffix: true })}
          </p>
        </div>
      </div>
    </>
  );
  const onClick = () => { if (group.alerts.length === 1) onMarkRead(); };
  return (
    <div className="group/row relative border-b">
      {group.key === '131042' ? (
        <button type="button" onClick={onOpenPayment} className="hover:bg-muted block w-full p-3 pr-20 text-left">{body}</button>
      ) : (
        <Link href={groupHref(group)} onClick={onClick} className="hover:bg-muted block p-3 pr-20">{body}</Link>
      )}
      <button
        type="button"
        onClick={onMarkRead}
        className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2 rounded px-1.5 py-0.5 text-[11px] hover:underline"
        aria-label={`Mark ${group.title} alerts as read`}
      >
        Mark read
      </button>
    </div>
  );
}

function AlertRow({ alert, onOpenPayment, onMarkRead }: {
  alert: Notification;
  onOpenPayment: () => void;
  onMarkRead: () => void;
}) {
  const key = alert.type === 'whatsapp_disconnected' ? 'connection' : alertCode(alert) ?? 'other';
  const info = describeAlertGroup(key, [alert]);
  const contact = alert.type === 'whatsapp_disconnected' ? null : alertContact(alert);
  const href = key === 'connection'
    ? '/settings?tab=whatsapp'
    : alert.conversation_id ? `/inbox?c=${alert.conversation_id}` : '/notifications';
  const body = (
    <div className="flex items-start gap-2">
      <span aria-hidden className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_STYLE[info.severity].dot)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{contact ?? info.title}</p>
        {contact && <p className="text-muted-foreground mt-0.5 text-xs break-words">{info.title}</p>}
        <p className="text-muted-foreground mt-1 text-[11px]">
          {formatDistanceToNow(new Date(alert.created_at), { addSuffix: true })}
        </p>
      </div>
    </div>
  );
  return (
    <div className="relative border-b">
      {key === '131042' ? (
        <button type="button" onClick={onOpenPayment} className="hover:bg-muted block w-full p-3 pr-20 text-left">{body}</button>
      ) : (
        <Link href={href} onClick={onMarkRead} className="hover:bg-muted block p-3 pr-20">{body}</Link>
      )}
      <button
        type="button"
        onClick={onMarkRead}
        className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2 rounded px-1.5 py-0.5 text-[11px] hover:underline"
        aria-label={`Mark alert${contact ? ` for ${contact}` : ''} as read`}
      >
        Mark read
      </button>
    </div>
  );
}
