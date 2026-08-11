'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Bell, Check, Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { InboxReminder } from '@/types'

type DueReminder = InboxReminder & {
  contact?: { id: string; name?: string | null; phone: string } | null
}

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultSnoozeLocal(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return toDatetimeLocalValue(d)
}

export function ReminderNotifications() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [reminders, setReminders] = useState<DueReminder[]>([])
  const [actingId, setActingId] = useState<string | null>(null)
  const [snoozeId, setSnoozeId] = useState<string | null>(null)
  const [snoozeLocal, setSnoozeLocal] = useState(defaultSnoozeLocal)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox/reminders', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { reminders?: DueReminder[] }
      setReminders(data.reminders ?? [])
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

  const handleComplete = useCallback(
    async (id: string) => {
      setActingId(id)
      try {
        const res = await fetch(`/api/inbox/reminders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'complete' }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          toast.error(body?.error ?? 'Failed to complete reminder')
          return
        }
        setReminders((prev) => prev.filter((r) => r.id !== id))
        toast.success('Reminder completed')
      } catch {
        toast.error('Failed to complete reminder')
      } finally {
        setActingId(null)
      }
    },
    [],
  )

  const handleSnooze = useCallback(
    async (id: string) => {
      const due = new Date(snoozeLocal)
      if (Number.isNaN(due.getTime())) {
        toast.error('Pick a valid date and time')
        return
      }
      if (due.getTime() <= Date.now()) {
        toast.error('Snooze time must be in the future')
        return
      }

      setActingId(id)
      try {
        const res = await fetch(`/api/inbox/reminders/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'snooze',
            due_at: due.toISOString(),
          }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          toast.error(body?.error ?? 'Failed to snooze reminder')
          return
        }
        setReminders((prev) => prev.filter((r) => r.id !== id))
        setSnoozeId(null)
        toast.success(`Snoozed until ${format(due, 'PPp')}`)
      } catch {
        toast.error('Failed to snooze reminder')
      } finally {
        setActingId(null)
      }
    },
    [snoozeLocal],
  )

  const count = reminders.length

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
        className="w-[min(100vw-2rem,22rem)] p-0"
      >
        <div className="border-b border-border px-3 py-2">
          <p className="text-sm font-medium text-foreground">Follow-up reminders</p>
          <p className="text-xs text-muted-foreground">
            Due now for this brand
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Loading…
          </div>
        ) : count === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            No reminders due
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <ul className="divide-y divide-border">
              {reminders.map((reminder) => {
                const name =
                  reminder.contact?.name?.trim() ||
                  reminder.contact?.phone ||
                  'Contact'
                const phone = reminder.contact?.phone ?? '—'
                const busy = actingId === reminder.id

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

                    {snoozeId === reminder.id ? (
                      <div className="mt-2 flex flex-col gap-2">
                        <Input
                          type="datetime-local"
                          value={snoozeLocal}
                          onChange={(e) => setSnoozeLocal(e.target.value)}
                          disabled={busy}
                        />
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            className="flex-1"
                            disabled={busy}
                            onClick={() => void handleSnooze(reminder.id)}
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Clock className="size-3.5" />
                            )}
                            Snooze
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() => setSnoozeId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => void handleComplete(reminder.id)}
                        >
                          {busy ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Check className="size-3.5" />
                          )}
                          Complete
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          className="flex-1"
                          disabled={busy}
                          onClick={() => {
                            setSnoozeId(reminder.id)
                            setSnoozeLocal(defaultSnoozeLocal())
                          }}
                        >
                          <Clock className="size-3.5" />
                          Snooze
                        </Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </ScrollArea>
        )}
      </PopoverContent>
    </Popover>
  )
}
