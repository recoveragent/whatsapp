import { NextResponse } from 'next/server'

import { handleFlowInboundWebhook } from '@/lib/flows/dispatch-external'

/**
 * POST /api/flows/webhook/[token]
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const result = await handleFlowInboundWebhook(token, payload)
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, flow_id: result.flow_id },
      { status: result.status },
    )
  }

  return NextResponse.json({
    ok: true,
    flow_id: result.flow_id,
    message: result.error,
  })
}
