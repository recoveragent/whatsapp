'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { Bell, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useAuth } from '@/hooks/use-auth'
import { REMINDER_NOTE_MAX_LENGTH } from '@/lib/inbox/reminders'
import type { AccountMember } from '@/types'

function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function defaultDueLocal(): string {
  const d = new Date()
  d.setHours(d.getHours() + 1, 0, 0, 0)
  return toDatetimeLocalValue(d)
}

function memberLabel(member: AccountMember, currentUserId?: string | null): string {
  const name = member.full_name?.trim() || member.email?.trim() || member.user_id
  if (currentUserId && member.user_id === currentUserId) {
    return `${name} (me)`
  }
  return name
}

interface ScheduleReminderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: string
  contactLabel?: string
  onScheduled?: () => void
}

export function ScheduleReminderDialog({
  open,
  onOpenChange,
  conversationId,
  contactLabel,
  onScheduled,
}: ScheduleReminderDialogProps) {
  const { user } = useAuth()
  const [dueLocal, setDueLocal] = useState(defaultDueLocal)
  const [note, setNote] = useState('')
  const [assigneeId, setAssigneeId] = useState('')
  const [members, setMembers] = useState<AccountMember[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const reset = useCallback(() => {
    setDueLocal(defaultDueLocal())
    setNote('')
    setAssigneeId(user?.id ?? '')
  }, [user?.id])

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setMembersLoading(true)

    void (async () => {
      try {
        const res = await fetch('/api/account/members', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { members?: AccountMember[] }
        if (cancelled) return
        const loaded = data.members ?? []
        setMembers(loaded)
        setAssigneeId((prev) => {
          if (prev && loaded.some((m) => m.user_id === prev)) return prev
          if (user?.id && loaded.some((m) => m.user_id === user.id)) {
            return user.id
          }
          return loaded[0]?.user_id ?? ''
        })
      } catch {
        // Dialog stays usable; submit will fail if assignee is missing.
      } finally {
        if (!cancelled) setMembersLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, user?.id])

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
    if (!assigneeId) {
      toast.error('Choose who should follow up')
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
      const res = await fetch('/api/inbox/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversation_id: conversationId,
          due_at: due.toISOString(),
          note: trimmed,
          assignee_id: assigneeId,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string
        } | null
        toast.error(body?.error ?? 'Failed to schedule reminder')
        return
      }

      onScheduled?.()
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
    assigneeId,
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
            Schedule reminder
          </DialogTitle>
          <DialogDescription>
            {contactLabel
              ? `Remind the team about ${contactLabel} at the time you pick.`
              : 'Remind the team at the time you pick. It will appear in the header bell.'}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-1">
          <div className="grid gap-2">
            <Label htmlFor="reminder-due">Date and time</Label>
            <Input
              id="reminder-due"
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
            <Label htmlFor="reminder-note">Note</Label>
            <Textarea
              id="reminder-note"
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
          <div className="grid gap-2">
            <Label htmlFor="reminder-assignee">Whom to follow up</Label>
            {membersLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading team…
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team members found
              </p>
            ) : (
              <Select
                value={assigneeId}
                onValueChange={(value) => {
                  if (value) setAssigneeId(value)
                }}
                disabled={submitting}
              >
                <SelectTrigger id="reminder-assignee">
                  <SelectValue placeholder="Select a team member" />
                </SelectTrigger>
                <SelectContent>
                  {members.map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      {memberLabel(member, user?.id)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
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
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || membersLoading || members.length === 0}
          >
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
