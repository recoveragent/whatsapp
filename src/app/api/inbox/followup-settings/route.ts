import { NextResponse } from 'next/server'

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account'
import {
  getFollowupSettings,
  upsertFollowupSettings,
  DEFAULT_FOLLOWUP_DELAY_HOURS,
  DEFAULT_FOLLOWUP_MESSAGE,
} from '@/lib/inbox/followup'

export async function GET() {
  try {
    const ctx = await getCurrentAccount()
    const settings = await getFollowupSettings(ctx.supabase, ctx.accountId)
    return NextResponse.json(settings)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin')
    const body = (await request.json()) as {
      delay_hours?: number
      message_text?: string
    }

    if (
      body.delay_hours != null &&
      (!Number.isInteger(body.delay_hours) ||
        body.delay_hours < 1 ||
        body.delay_hours > 168)
    ) {
      return NextResponse.json(
        { error: 'delay_hours must be an integer between 1 and 168' },
        { status: 400 },
      )
    }

    if (body.message_text != null && !String(body.message_text).trim()) {
      return NextResponse.json(
        { error: 'message_text cannot be empty' },
        { status: 400 },
      )
    }

    const settings = await upsertFollowupSettings(ctx.supabase, ctx.accountId, {
      delay_hours: body.delay_hours,
      message_text: body.message_text,
    })

    return NextResponse.json(settings)
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST() {
  try {
    const ctx = await requireRole('admin')
    const settings = await upsertFollowupSettings(ctx.supabase, ctx.accountId, {
      delay_hours: DEFAULT_FOLLOWUP_DELAY_HOURS,
      message_text: DEFAULT_FOLLOWUP_MESSAGE,
    })
    return NextResponse.json(settings)
  } catch (err) {
    return toErrorResponse(err)
  }
}
