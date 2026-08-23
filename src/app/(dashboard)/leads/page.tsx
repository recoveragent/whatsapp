'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  MessageSquare,
  Phone,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/hooks/use-auth';
import { useCan } from '@/hooks/use-can';
import type { CrmTaskOutcome } from '@/lib/leads/types';
import type { LeadQueue, QueueTask, RepliedLead } from '@/lib/leads/queue';
import { PageHeader } from '@/components/layout/page-header';
import { Button, buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const OUTCOMES: { id: CrmTaskOutcome; label: string }[] = [
  { id: 'no_answer', label: 'No answer' },
  { id: 'busy', label: 'Busy' },
  { id: 'later', label: 'Later' },
  { id: 'connected', label: 'Talked' },
  { id: 'booked', label: 'Booked' },
  { id: 'not_interested', label: 'Not interested' },
  { id: 'wrong_number', label: 'Wrong number' },
];

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.startsWith('+') ? digits : `+${digits}`}`;
}

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function LeadsPage() {
  const router = useRouter();
  const { user, isLeadGenBrand, profileLoading } = useAuth();
  const canAct = useCan('send-messages');
  const [queue, setQueue] = useState<LeadQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/leads/queue', { cache: 'no-store' });
      const data = (await res.json()) as LeadQueue & { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Failed to load queue');
      setQueue(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading && !isLeadGenBrand) {
      router.replace('/dashboard');
    }
  }, [profileLoading, isLeadGenBrand, router]);

  useEffect(() => {
    if (profileLoading || !isLeadGenBrand) return;
    void load();
    const id = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(id);
  }, [load, isLeadGenBrand, profileLoading]);

  async function claim(taskId: string) {
    setBusyId(taskId);
    try {
      const res = await fetch(`/api/leads/tasks/${taskId}/claim`, { method: 'POST' });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not claim');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Claim failed');
    } finally {
      setBusyId(null);
    }
  }

  async function complete(taskId: string, outcome: CrmTaskOutcome) {
    setBusyId(taskId);
    try {
      const res = await fetch(`/api/leads/tasks/${taskId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? 'Could not save outcome');
      toast.success('Logged');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusyId(null);
    }
  }

  async function syncNow() {
    setSyncing(true);
    try {
      const res = await fetch('/api/leads/sync', { method: 'POST' });
      const data = (await res.json()) as {
        error?: string;
        sheets?: { enrolled?: number; skipped?: number; errors?: string[] };
        cadences?: { sent?: number; tasks?: number; errors?: string[] };
      };
      if (!res.ok) throw new Error(data.error ?? 'Sync failed');
      const enrolled = data.sheets?.enrolled ?? 0;
      const sent = data.cadences?.sent ?? 0;
      const tasks = data.cadences?.tasks ?? 0;
      const errors = [
        ...(data.sheets?.errors ?? []),
        ...(data.cadences?.errors ?? []),
      ];
      if (errors.length > 0) {
        toast.error(errors[0] ?? 'Sync finished with errors');
      } else if (enrolled === 0 && sent === 0 && tasks === 0) {
        toast.message(
          'No new rows. If the sheet already has leads, edit the campaign and turn on “Import existing rows”.',
        );
      } else {
        toast.success(
          `Synced: ${enrolled} enrolled, ${sent} WhatsApp sent, ${tasks} call tasks`,
        );
      }
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  const mine = user?.id;

  if (profileLoading || !isLeadGenBrand) {
    return null;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Leads"
        subtitle="Call who the cadence queued. Replies jump here — cadences pause themselves."
        actions={
          <div className="flex flex-wrap gap-2">
            {canAct ? (
              <Button
                type="button"
                size="sm"
                disabled={syncing}
                onClick={() => void syncNow()}
              >
                {syncing ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5" />
                )}
                <span className="ml-1.5">Sync now</span>
              </Button>
            ) : null}
            <Button type="button" variant="outline" size="sm" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        }
      />

      {loading && !queue ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Loading queue…
        </div>
      ) : error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : queue ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Overdue calls" value={queue.stats.overdue} warn />
            <Stat label="Due now" value={queue.stats.due_now} />
            <Stat label="Replied" value={queue.stats.replied} />
            <Stat label="In cadence" value={queue.stats.in_cadence} />
          </div>

          <section className="space-y-3">
            <h2 className="font-cabinet text-lg font-semibold">Calls</h2>
            {queue.calls.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No call tasks yet. Click <strong>Sync now</strong> to pull
                campaign-sheet rows. Call steps appear after the first WhatsApp
                (about 2 hours, only during 10:00–19:00 IST).
              </p>
            ) : (
              <div className="space-y-3">
                {queue.calls.map((task) => (
                  <CallCard
                    key={task.id}
                    task={task}
                    mine={mine}
                    canAct={canAct}
                    busy={busyId === task.id}
                    onClaim={() => void claim(task.id)}
                    onComplete={(o) => void complete(task.id, o)}
                  />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-cabinet text-lg font-semibold">Replied — talk now</h2>
            {queue.replied.length === 0 ? (
              <p className="text-sm text-muted-foreground">No one waiting on a reply.</p>
            ) : (
              <div className="space-y-2">
                {queue.replied.map((lead) => (
                  <RepliedRow key={lead.contact_id} lead={lead} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <h2 className="font-cabinet text-lg font-semibold text-muted-foreground">
              Waiting
            </h2>
            {queue.waiting.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active cadences.</p>
            ) : (
              <div className="divide-y rounded-lg border">
                {queue.waiting.map((row) => (
                  <div
                    key={row.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <span className="font-medium">{row.name || row.phone}</span>
                      <span className="text-muted-foreground">
                        {' '}
                        · {row.campaign_name || row.cadence_name || 'Cadence'} · step{' '}
                        {row.current_step_position}
                      </span>
                      {row.last_error ? (
                        <p className="text-xs text-amber-700 dark:text-amber-400">
                          {row.last_error}
                        </p>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      Next {formatWhen(row.next_run_at)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: number;
  warn?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-cabinet text-2xl font-bold ${warn && value > 0 ? 'text-amber-600' : ''}`}>
        {value}
      </p>
    </div>
  );
}

function CallCard({
  task,
  mine,
  canAct,
  busy,
  onClaim,
  onComplete,
}: {
  task: QueueTask;
  mine?: string;
  canAct: boolean;
  busy: boolean;
  onClaim: () => void;
  onComplete: (o: CrmTaskOutcome) => void;
}) {
  const now = Date.now();
  const held =
    task.status === 'claimed' &&
    task.claimed_by &&
    task.claimed_until &&
    new Date(task.claimed_until).getTime() > now;
  const mineHeld = held && task.claimed_by === mine;
  const overdue = new Date(task.due_at).getTime() < now;
  const phone = task.contact?.phone ?? '';
  const name = task.contact?.name || phone;
  const lang = task.contact?.lead_language === 'hi' ? 'Hindi' : 'English';

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{name}</p>
            {overdue ? <Badge variant="destructive">Overdue</Badge> : null}
            <Badge variant="outline">{task.type === 'voice_note' ? 'Voice' : 'Call'}</Badge>
            <Badge variant="outline">{lang}</Badge>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {phone}
            {task.campaign_name ? ` · ${task.campaign_name}` : ''}
            {' · due '}
            {formatWhen(task.due_at)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {phone ? (
            <a href={telHref(phone)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
              <Phone className="size-3.5" />
              <span className="ml-1.5">Call</span>
            </a>
          ) : null}
          {task.conversation_id ? (
            <Link
              href={`/inbox?c=${task.conversation_id}`}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}
            >
              <MessageSquare className="size-3.5" />
              <span className="ml-1.5">Chat</span>
            </Link>
          ) : null}
        </div>
      </div>
      {task.script ? (
        <p className="rounded-md bg-muted/60 px-3 py-2 text-sm">{task.script}</p>
      ) : null}
      {held && !mineHeld ? (
        <p className="text-xs text-muted-foreground">
          Claimed by {task.claimed_name ?? 'a teammate'} until {formatWhen(task.claimed_until)}
        </p>
      ) : null}
      {canAct && (!held || mineHeld) ? (
        mineHeld ? (
          <div className="flex flex-wrap gap-1.5">
            {OUTCOMES.map((o) => (
              <Button
                key={o.id}
                type="button"
                size="sm"
                variant={o.id === 'booked' ? 'default' : 'outline'}
                disabled={busy}
                onClick={() => onComplete(o.id)}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                <span className={busy ? 'ml-1' : ''}>{o.label}</span>
              </Button>
            ))}
          </div>
        ) : (
          <Button type="button" size="sm" disabled={busy} onClick={onClaim}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            <span className={busy ? 'ml-1.5' : ''}>Claim this call</span>
          </Button>
        )
      ) : null}
    </div>
  );
}

function RepliedRow({ lead }: { lead: RepliedLead }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5">
      <div>
        <p className="text-sm font-medium">{lead.name || lead.phone}</p>
        <p className="text-xs text-muted-foreground">
          {lead.phone}
          {lead.unread_count > 0 ? ` · ${lead.unread_count} unread` : ''}
        </p>
      </div>
      {lead.conversation_id ? (
        <Link
          href={`/inbox?c=${lead.conversation_id}`}
          className={cn(buttonVariants({ size: 'sm' }))}
        >
          Open inbox
        </Link>
      ) : (
        <a href={telHref(lead.phone)} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
          Call
        </a>
      )}
    </div>
  );
}
