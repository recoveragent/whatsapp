import { NextResponse } from 'next/server'

import { requireLeadGenAccount, toErrorResponse } from '@/lib/auth/account'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { claimCrmTask } from '@/lib/leads/tasks'

/**
 * POST /api/leads/tasks/[id]/claim
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireLeadGenAccount('agent')
    const { id } = await params
    const result = await claimCrmTask({
      db: ctx.supabase,
      accountId: ctx.accountId,
      userId: ctx.userId,
      taskId: id,
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
