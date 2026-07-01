import { NextResponse } from 'next/server';

const OPS_MESSAGE =
  'WhatsApp API credentials are configured by Recover Agent ops at /admin/brands/[id]/whatsapp. Brand admins can view connection status under Settings → WhatsApp number.';

function opsOnly() {
  return NextResponse.json({ error: OPS_MESSAGE }, { status: 403 });
}

/** @deprecated Brand-facing — use GET /api/whatsapp/connection for status. */
export async function GET() {
  return opsOnly();
}

/** @deprecated Ops-only — use POST /api/admin/brands/[id]/whatsapp. */
export async function POST() {
  return opsOnly();
}

/** @deprecated Ops-only — use DELETE /api/admin/brands/[id]/whatsapp. */
export async function DELETE() {
  return opsOnly();
}
