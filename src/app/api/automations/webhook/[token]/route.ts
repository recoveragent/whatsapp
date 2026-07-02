import { NextResponse } from 'next/server'

import { handleInboundWebhook } from '@/lib/automations/webhook-handler'

/**
 * POST /api/automations/webhook/[token]
 *
 * Public inbound webhook for automation triggers. Third-party platforms
 * send JSON payloads here; fields are mapped per the automation config.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  let payload: unknown
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      payload = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  } else {
    const text = await request.text()
    try {
      payload = JSON.parse(text)
    } catch {
      return NextResponse.json(
        { error: 'Body must be JSON (Content-Type: application/json)' },
        { status: 400 },
      )
    }
  }

  const result = await handleInboundWebhook(token, payload)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, automation_id: result.automation_id },
      { status: result.status },
    )
  }

  return NextResponse.json({
    ok: true,
    automation_id: result.automation_id,
    contact_id: result.contact_id,
    message: result.error,
  })
}
