import { NextResponse } from 'next/server'

import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { loadLeadQueue } from '@/lib/leads/queue'

/**
 * GET /api/leads/queue — today's call queue, replied leads, waiting cadences.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const queue = await loadLeadQueue(ctx.supabase, ctx.accountId)
    return NextResponse.json(queue)
  } catch (err) {
    if (err && typeof err === 'object' && 'message' in err) {
      const hint = leadsMigrationMessage(err as { message?: string; code?: string })
      if (hint) return NextResponse.json({ error: hint }, { status: 500 })
    }
    return toErrorResponse(err)
  }
}
