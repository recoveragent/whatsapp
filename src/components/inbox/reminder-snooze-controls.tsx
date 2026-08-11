'use client'

import { useCallback, useState } from 'react'
import { format } from 'date-fns'
import { Clock, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  SNOOZE_PRESETS_MINUTES,
  dueAtFromSnoozeMinutes,
  snoozePresetLabel,
} from '@/lib/inbox/reminders'

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultCustomLocal(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return toDatetimeLocalValue(d)
}

interface ReminderSnoozeControlsProps {
  reminderId: string
  disabled?: boolean
  onSnoozed: (reminderId: string) => void
  compact?: boolean
}

export function ReminderSnoozeControls({
  reminderId,
  disabled,
  onSnoozed,
  compact,
}: ReminderSnoozeControlsProps) {
  const [busy, setBusy] = useState(false)
  const [customLocal, setCustomLocal] = useState(defaultCustomLocal)

  const snoozeTo = useCallback(
    async (dueAtIso: string) => {
      const due = new Date(dueAtIso)
      if (Number.isNaN(due.getTime()) || due.getTime() <= Date.now()) {
        toast.error('Snooze time must be in the future')
        return
      }

      setBusy(true)
      try {
        const res = await fetch(`/api/inbox/reminders/${reminderId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'snooze', due_at: dueAtIso }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as {
            error?: string
          } | null
          toast.error(body?.error ?? 'Failed to snooze reminder')
          return
        }
        onSnoozed(reminderId)
        toast.success(`Snoozed until ${format(due, 'PPp')}`)
      } catch {
        toast.error('Failed to snooze reminder')
      } finally {
        setBusy(false)
      }
    },
    [reminderId, onSnoozed],
  )

  return (
    <div className={compact ? 'mt-2 space-y-2' : 'space-y-2'}>
      <div className="flex flex-wrap gap-1.5">
        {SNOOZE_PRESETS_MINUTES.map((minutes) => (
          <Button
            key={minutes}
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={disabled || busy}
            onClick={() => void snoozeTo(dueAtFromSnoozeMinutes(minutes))}
          >
            {snoozePresetLabel(minutes)}
          </Button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input
          type="datetime-local"
          value={customLocal}
          onChange={(e) => setCustomLocal(e.target.value)}
          disabled={disabled || busy}
          className="h-8 text-xs"
        />
        <Button
          type="button"
          size="sm"
          className="shrink-0"
          disabled={disabled || busy}
          onClick={() => {
            const due = new Date(customLocal)
            if (Number.isNaN(due.getTime())) {
              toast.error('Pick a valid date and time')
              return
            }
            void snoozeTo(due.toISOString())
          }}
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Clock className="size-3.5" />
          )}
          Snooze
        </Button>
      </div>
    </div>
  )
}
