'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Bell, Loader2 } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
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

function contactLabel(reminder: ReminderRow): string {
  return (
    reminder.contact?.name?.trim() ||
    reminder.contact?.phone ||
    'Contact'
  )
}

export function ReminderNotifications() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [due, setDue] = useState<ReminderRow[]>([])
  const [history, setHistory] = useState<ReminderRow[]>([])
  const [snoozeId, setSnoozeId] = useState<string | null>(null)

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
      setDue(data.reminders ?? [])
      setHistory(data.history ?? [])
    } catch {
      // silent — header should not toast on background poll failures
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const interval = window.setInterval(() => void load(), 30_000)
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

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <ScrollArea className="max-h-96">
            <div className="border-b border-border px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Due
              </p>
            </div>
            {due.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
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
                              setDue((prev) =>
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

            <div className="border-y border-border px-3 py-2">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                History
              </p>
            </div>
            {history.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
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
