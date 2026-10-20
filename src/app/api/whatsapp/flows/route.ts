import { NextResponse } from 'next/server'
import { requireRole, toErrorResponse } from '@/lib/auth/account'
import { listWabaFlows, type MetaFlowSummary } from '@/lib/whatsapp/meta-api'
import { loadAccountWabas } from '@/lib/whatsapp/waba-credentials'

/** WhatsApp Flows (forms) on the account's WABAs, for the Send WhatsApp Form node. */
export async function GET() {
  let accountId: string
  try {
    accountId = (await requireRole('agent')).accountId
  } catch (err) {
    return toErrorResponse(err)
  }
  try {
    const wabas = await loadAccountWabas(accountId)
    if (wabas.length === 0) {
      return NextResponse.json(
        { error: 'WhatsApp not connected. Connect your WhatsApp Business account in Settings first.' },
        { status: 400 },
      )
    }
    const flows: MetaFlowSummary[] = []
    for (const waba of wabas) {
      flows.push(...(await listWabaFlows(waba)))
    }
    return NextResponse.json({ flows })
  } catch (err) {
    // Usually Meta: missing whatsapp_business_management permission, bad ID.
    const message = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
