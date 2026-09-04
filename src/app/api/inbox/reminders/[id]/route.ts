import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { completeReminder, snoozeReminder } from '@/lib/inbox/reminders'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('agent')
    const { id } = await params
    const body = (await request.json()) as {
      action?: 'complete' | 'snooze'
      due_at?: string
    }

    if (body.action === 'complete') {
      const reminder = await completeReminder(
        ctx.supabase,
        ctx.accountId,
        id,
        ctx.userId,
      )
      return NextResponse.json(reminder)
    }

    if (body.action === 'snooze') {
      const dueAtRaw = body.due_at?.trim()
      if (!dueAtRaw) {
        return NextResponse.json(
          { error: 'due_at is required to snooze' },
          { status: 400 },
        )
      }
      const dueAt = new Date(dueAtRaw)
      if (Number.isNaN(dueAt.getTime())) {
        return NextResponse.json({ error: 'due_at is invalid' }, { status: 400 })
      }
      if (dueAt.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: 'due_at must be in the future' },
          { status: 400 },
        )
      }

      const reminder = await snoozeReminder(
        ctx.supabase,
        ctx.accountId,
        id,
        dueAt.toISOString(),
      )
      return NextResponse.json(reminder)
    }

    return NextResponse.json(
      { error: 'action must be complete or snooze' },
      { status: 400 },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : ''
    if (/not found/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 404 })
    }
    return toErrorResponse(err)
  }
}
