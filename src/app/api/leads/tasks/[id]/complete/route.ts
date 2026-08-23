import { NextResponse } from 'next/server'

import { requireLeadGenAccount, toErrorResponse } from '@/lib/auth/account'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { completeCrmTask } from '@/lib/leads/tasks'

/**
 * POST /api/leads/tasks/[id]/complete
 * Body: { outcome, note? }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireLeadGenAccount('agent')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as {
      outcome?: unknown
      note?: string
    } | null

    const result = await completeCrmTask({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      taskId: id,
      outcome: body?.outcome,
      note: body?.note,
    })
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err && typeof err === 'object' && 'message' in err) {
      const hint = leadsMigrationMessage(err as { message?: string; code?: string })
      if (hint) return NextResponse.json({ error: hint }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
