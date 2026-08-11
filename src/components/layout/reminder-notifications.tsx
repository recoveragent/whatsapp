'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ReminderSnoozeControls } from '@/components/inbox/reminder-snooze-controls'
import type { InboxReminder } from '@/types'

type ReminderRow = InboxReminder & {
  contact?: { id: string; name?: string | null; phone: string } | null
}

type PanelTab = 'due' | 'history'

function contactLabel(reminder: ReminderRow): string {
  return (
    reminder.contact?.name?.trim() ||
    reminder.contact?.phone ||
    'Contact'
  )
}

function splitDue(pending: ReminderRow[], nowMs: number) {
  const due: ReminderRow[] = []
  const upcoming: ReminderRow[] = []
  for (const r of pending) {
    if (new Date(r.due_at).getTime() <= nowMs) due.push(r)
    else upcoming.push(r)
  }
  return { due, upcoming }
}

function notifyReminderDue(reminder: ReminderRow) {
  const name = contactLabel(reminder)
  toast.message(`Follow-up due: ${name}`, {
    description: reminder.note,
    duration: 12_000,
  })

  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  try {
    new Notification(`Follow-up due: ${name}`, {
      body: reminder.note,
      tag: `inbox-reminder-${reminder.id}`,
    })
  } catch {
    // ignore — browser may block even when permission is granted
  }
}

export function ReminderNotifications() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<PanelTab>('due')
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState<ReminderRow[]>([])
  const [history, setHistory] = useState<ReminderRow[]>([])
  const [snoozeId, setSnoozeId] = useState<string | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const knownDueIdsRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/reminders?scope=all', {
        cache: 'no-store',
      })
      if (!res.ok) return
      const data = (await res.json()) as {
        reminders?: ReminderRow[]
        history?: ReminderRow[]
      }
      setPending(data.reminders ?? [])
      setHistory(data.history ?? [])
      setNowMs(Date.now())
    } catch {
      // silent — header should not toast on background poll failures
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 15_000)
    return () => window.clearInterval(interval)
  }, [load])

  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('inbox-reminders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inbox_reminders' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  const { due, upcoming } = useMemo(
    () => splitDue(pending, nowMs),
    [pending, nowMs],
  )

  // When the next upcoming reminder hits due_at, promote it immediately
  // (DB rows don't change at due time, so realtime alone is not enough).
  useEffect(() => {
    if (upcoming.length === 0) return
    const nextDueMs = Math.min(
      ...upcoming.map((r) => new Date(r.due_at).getTime()),
    )
    const delay = Math.max(0, nextDueMs - Date.now()) + 50
    const timer = window.setTimeout(() => {
      setNowMs(Date.now())
    }, Math.min(delay, 2_147_000_000))
    return () => window.clearTimeout(timer)
  }, [upcoming])

  // Toast / browser notification for newly due items.
  useEffect(() => {
    const dueIds = new Set(due.map((r) => r.id))
    if (!primedRef.current) {
      knownDueIdsRef.current = dueIds
      primedRef.current = true
      return
    }

    for (const reminder of due) {
      if (!knownDueIdsRef.current.has(reminder.id)) {
        notifyReminderDue(reminder)
      }
    }
    knownDueIdsRef.current = dueIds
  }, [due])

  // Ask once for browser notifications after the user opens the panel.
  useEffect(() => {
    if (!open) return
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'default') return
    void Notification.requestPermission().catch(() => {})
  }, [open])

  const count = due.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={
          count > 0
            ? `Follow-up reminders, ${count} due`
            : 'Follow-up reminders'
        }
      >
        <Bell className="h-5 w-5" />
        {count > 0 ? (
          <Badge
            variant="default"
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center px-1 text-[10px] leading-none"
          >
            {count > 99 ? '99+' : count}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-[min(100vw-2rem,22rem)] gap-0 p-0"
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">Follow-up reminders</p>
          <p className="text-xs text-muted-foreground">
            Open a chat to mark complete
          </p>
        </div>

        <div className="flex border-b border-border">
          <button
            type="button"
            className={cn(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors',
              tab === 'due'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('due')}
          >
            Due{count > 0 ? ` (${count})` : ''}
          </button>
          <button
            type="button"
            className={cn(
              'flex-1 px-3 py-2 text-xs font-medium transition-colors',
              tab === 'history'
                ? 'border-b-2 border-primary text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setTab('history')}
          >
            History
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : tab === 'due' ? (
          <ScrollArea className="max-h-96">
            {due.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No reminders due
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {due.map((reminder) => {
                  const name = contactLabel(reminder)
                  const phone = reminder.contact?.phone ?? '—'

                  return (
                    <li key={reminder.id} className="px-3 py-3">
                      <Link
                        href={`/inbox?c=${reminder.conversation_id}`}
                        className="block text-sm font-medium text-foreground hover:underline"
                        onClick={() => setOpen(false)}
                      >
                        {name}
                      </Link>
                      <p className="mt-0.5 text-xs text-muted-foreground">{phone}</p>
                      <p className="mt-1 text-sm text-foreground/90">{reminder.note}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Due {format(new Date(reminder.due_at), 'PPp')}
                      </p>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        Open chat → Complete in the contact panel
                      </p>

                      {snoozeId === reminder.id ? (
                        <div className="mt-2">
                          <ReminderSnoozeControls
                            reminderId={reminder.id}
                            onSnoozed={() => {
                              setPending((prev) =>
                                prev.filter((r) => r.id !== reminder.id),
                              )
                              setSnoozeId(null)
                              void load()
                            }}
                          />
                          <button
                            type="button"
                            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setSnoozeId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="mt-2 text-xs font-medium text-primary hover:underline"
                          onClick={() => setSnoozeId(reminder.id)}
                        >
                          Snooze…
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </ScrollArea>
        ) : (
          <ScrollArea className="max-h-96">
            {history.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No completed reminders yet
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {history.map((reminder) => (
                  <li key={reminder.id} className="px-3 py-3 opacity-80">
                    <Link
                      href={`/inbox?c=${reminder.conversation_id}`}
                      className="block text-sm font-medium text-foreground hover:underline"
                      onClick={() => setOpen(false)}
                    >
                      {contactLabel(reminder)}
                    </Link>
                    <p className="mt-1 text-sm text-foreground/90">{reminder.note}</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Completed{' '}
                      {reminder.completed_at
                        ? format(new Date(reminder.completed_at), 'PPp')
                        : '—'}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
