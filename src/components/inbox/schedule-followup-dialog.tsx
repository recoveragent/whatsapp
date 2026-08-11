'use client'

import { useCallback, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import type { Conversation, Message } from '@/types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { REMINDER_NOTE_MAX_LENGTH } from '@/lib/inbox/reminders'

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultDueLocal(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return toDatetimeLocalValue(d)
}

interface ScheduleFollowupDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string
  contactLabel?: string
  onScheduled: (
    updated: Conversation & { system_message?: Message | null },
  ) => void
}

export function ScheduleFollowupDialog({
  open,
  onOpenChange,
  conversationId,
  contactLabel,
  onScheduled,
}: ScheduleFollowupDialogProps) {
  const [dueLocal, setDueLocal] = useState(defaultDueLocal)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setDueLocal(defaultDueLocal())
    setNote('')
  }, [])

  const preview = useMemo(() => {
    if (!dueLocal) return null
    const d = new Date(dueLocal)
    if (Number.isNaN(d.getTime())) return null
    return format(d, 'PPp')
  }, [dueLocal])

  const handleSubmit = useCallback(async () => {
    const trimmed = note.trim()
    if (!trimmed) {
      toast.error('Add a short note for the reminder')
      return
    }
    if (trimmed.length > REMINDER_NOTE_MAX_LENGTH) {
      toast.error(`Note must be at most ${REMINDER_NOTE_MAX_LENGTH} characters`)
      return
    }

    const due = new Date(dueLocal)
    if (Number.isNaN(due.getTime())) {
      toast.error('Pick a valid date and time')
      return
    }
    if (due.getTime() <= Date.now()) {
      toast.error('Reminder time must be in the future')
      return
    }

    setSubmitting(true)
    try {
      const statusRes = await fetch(
        `/api/inbox/conversations/${conversationId}/status`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'followup' }),
        },
      )
      if (!statusRes.ok) {
        const body = (await statusRes.json().catch(() => null)) as {
          error?: string
        } | null
        toast.error(body?.error ?? 'Failed to set follow-up status')
        return
      }

      const updated = (await statusRes.json()) as Conversation & {
        system_message?: Message | null
      }

      const reminderRes = await fetch('/api/inbox/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          due_at: due.toISOString(),
          note: trimmed,
        }),
      })
      if (!reminderRes.ok) {
        const body = (await reminderRes.json().catch(() => null)) as {
          error?: string
        } | null
        toast.error(body?.error ?? 'Failed to schedule reminder')
        return
      }

      onScheduled(updated)
      onOpenChange(false)
      reset()
      toast.success(
        preview
          ? `Reminder scheduled for ${preview}`
          : 'Reminder scheduled',
      )
    } catch {
      toast.error('Failed to schedule reminder')
    } finally {
      setSubmitting(false)
    }
  }, [
    note,
    dueLocal,
    conversationId,
    onScheduled,
    onOpenChange,
    reset,
    preview,
  ])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="size-4" />
            Schedule follow-up
          </DialogTitle>
          <DialogDescription>
            {contactLabel
              ? `Remind the team about ${contactLabel} at the time you pick.`
              : 'Remind the team at the time you pick. It will appear in the header bell.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="followup-due">Date and time</Label>
            <Input
              id="followup-due"
              type="datetime-local"
              value={dueLocal}
              onChange={(e) => setDueLocal(e.target.value)}
              disabled={submitting}
            />
            {preview ? (
              <p className="text-xs text-muted-foreground">{preview}</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="followup-note">Note</Label>
            <Textarea
              id="followup-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What should we follow up on?"
              rows={3}
              maxLength={REMINDER_NOTE_MAX_LENGTH}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              {note.trim().length}/{REMINDER_NOTE_MAX_LENGTH}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Scheduling…
              </>
            ) : (
              'Schedule'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
