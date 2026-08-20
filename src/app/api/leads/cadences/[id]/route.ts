import { NextResponse } from 'next/server'

import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { leadsMigrationMessage } from '@/lib/leads/db-errors'
import { CADENCE_CHANNELS, type CadenceChannel } from '@/lib/leads/types'

function cadenceError(err: unknown): NextResponse {
  if (err && typeof err === 'object' && 'message' in err) {
    const hint = leadsMigrationMessage(err as { message?: string; code?: string })
    if (hint) return NextResponse.json({ error: hint }, { status: 500 })
  }
  return toErrorResponse(err)
}

interface StepBody {
  position?: number
  delay_minutes?: number
  channel?: string
  template_name?: string | null
  script_en?: string | null
  script_hi?: string | null
}

function parseSteps(raw: unknown): StepBody[] | null {
  if (!Array.isArray(raw)) return null
  const steps: StepBody[] = []
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i]
    if (!row || typeof row !== 'object') return null
    const s = row as StepBody
    const channel = s.channel
    if (
      typeof channel !== 'string' ||
      !(CADENCE_CHANNELS as readonly string[]).includes(channel)
    ) {
      return null
    }
    const delay =
      typeof s.delay_minutes === 'number' && Number.isFinite(s.delay_minutes)
        ? Math.max(0, Math.floor(s.delay_minutes))
        : 0
    steps.push({
      position: i + 1,
      delay_minutes: delay,
      channel: channel as CadenceChannel,
      template_name:
        typeof s.template_name === 'string' ? s.template_name.trim() || null : null,
      script_en: typeof s.script_en === 'string' ? s.script_en.trim() || null : null,
      script_hi: typeof s.script_hi === 'string' ? s.script_hi.trim() || null : null,
    })
  }
  return steps
}

/**
 * PATCH /api/leads/cadences/[id]
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await requireRole('admin')
    const { id } = await params
    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null
    if (!body) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) patch.name = body.name.trim()
    if (typeof body.expire_after_days === 'number') {
      const days = Math.floor(body.expire_after_days)
      if (days < 1 || days > 365) {
        return NextResponse.json(
          { error: 'expire_after_days must be 1–365' },
          { status: 400 },
        )
      }
      patch.expire_after_days = days
    }
    if (typeof body.call_hours_start === 'string') {
      patch.call_hours_start = body.call_hours_start
    }
    if (typeof body.call_hours_end === 'string') {
      patch.call_hours_end = body.call_hours_end
    }
    if (Array.isArray(body.call_days)) {
      const days = body.call_days
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      if (days.length > 0) patch.call_days = days
    }

    if (Object.keys(patch).length > 0) {
      const { error } = await ctx.supabase
        .from('cadences')
        .update(patch)
        .eq('id', id)
        .eq('account_id', ctx.accountId)
      if (error) {
        const hint = leadsMigrationMessage(error)
        return NextResponse.json(
          { error: hint ?? error.message },
          { status: 500 },
        )
      }
    }

    if ('steps' in body) {
      const steps = parseSteps(body.steps)
      if (!steps) {
        return NextResponse.json({ error: 'Invalid steps' }, { status: 400 })
      }
      const { error: delErr } = await ctx.supabase
        .from('cadence_steps')
        .delete()
        .eq('cadence_id', id)
      if (delErr) {
        return NextResponse.json({ error: delErr.message }, { status: 500 })
      }
      if (steps.length > 0) {
        const { error: insErr } = await ctx.supabase.from('cadence_steps').insert(
          steps.map((s) => ({
            cadence_id: id,
            position: s.position,
            delay_minutes: s.delay_minutes,
            channel: s.channel,
            template_name: s.template_name,
            script_en: s.script_en,
            script_hi: s.script_hi,
          })),
        )
        if (insErr) {
          return NextResponse.json({ error: insErr.message }, { status: 500 })
        }
      }
    }

    const { data: cadence, error: loadErr } = await ctx.supabase
      .from('cadences')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle()
    if (loadErr || !cadence) {
      return NextResponse.json({ error: 'Cadence not found' }, { status: 404 })
    }
    const { data: stepRows } = await ctx.supabase
      .from('cadence_steps')
      .select('*')
      .eq('cadence_id', id)
      .order('position', { ascending: true })

    return NextResponse.json({ cadence: { ...cadence, steps: stepRows ?? [] } })
  } catch (err) {
    return cadenceError(err)
  }
}
