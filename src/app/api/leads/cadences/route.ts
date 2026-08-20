import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { ensureDefaultCadences, loadCadencesWithSteps } from '@/lib/leads/ensure-defaults'

function cadenceError(err: unknown): NextResponse {
  if (err && typeof err === 'object' && 'message' in err) {
    const hint = leadsMigrationMessage(err as { message?: string; code?: string })
    if (hint) return NextResponse.json({ error: hint }, { status: 500 })
  }
  return toErrorResponse(err)
}

/**
 * GET /api/leads/cadences — seeds New Instant Form + Reactivation if empty.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    await ensureDefaultCadences({
      db: supabaseAdmin(),
      accountId: ctx.accountId,
      userId: ctx.userId,
    })
    const cadences = await loadCadencesWithSteps(ctx.supabase, ctx.accountId)
    return NextResponse.json({ cadences })
  } catch (err) {
    return cadenceError(err)
  }
}

/**
 * POST /api/leads/cadences — create an extra custom cadence (copy of defaults).
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json().catch(() => null)) as {
      name?: string
    } | null
    const name = body?.name?.trim() || 'Custom cadence'

    const { data, error } = await ctx.supabase
      .from('cadences')
      .insert({
        account_id: ctx.accountId,
        user_id: ctx.userId,
        name,
        kind: 'custom',
      })
      .select('*')
      .single()

    if (error) {
      const hint = leadsMigrationMessage(error)
      return NextResponse.json(
        { error: hint ?? error.message },
        { status: 500 },
      )
    }
    return NextResponse.json({ cadence: { ...data, steps: [] } })
  } catch (err) {
    return cadenceError(err)
  }
}
