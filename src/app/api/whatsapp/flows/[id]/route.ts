import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { getFlowJson, listWabaFlows } from '@/lib/whatsapp/meta-api'
import { summarizeFlowJson } from '@/lib/whatsapp/flow-json'
import { loadAccountWabas } from '@/lib/whatsapp/waba-credentials'

/** Entry screen + submission field keys for one WhatsApp Flow. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }
  try {
    const { id } = await params
    if (!/^\d+$/.test(id)) {
      return NextResponse.json({ error: 'Invalid Flow ID.' }, { status: 400 })
    }
    // Only read Flows that belong to one of this account's WABAs.
    for (const waba of await loadAccountWabas(accountId)) {
      const flow = (await listWabaFlows(waba)).find((f) => f.id === id)
      if (!flow) continue
      const json = await getFlowJson({ flowId: id, accessToken: waba.accessToken })
      return NextResponse.json({ flow, ...summarizeFlowJson(json) })
    }
    return NextResponse.json(
      { error: 'Flow not found on your connected WhatsApp Business account.' },
      { status: 404 },
    )
  } catch (err) {
    // Usually Meta: missing whatsapp_business_management permission, bad ID.
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
