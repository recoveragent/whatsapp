import { NextResponse } from 'next/server';

const OPS_MESSAGE =
  'Registration diagnostics are available on the Recover Agent ops WhatsApp setup page at /admin/brands/[id]/whatsapp.';

/** @deprecated Ops-only — use GET /api/admin/brands/[id]/whatsapp/verify-registration. */
export async function GET() {
  return NextResponse.json({ error: OPS_MESSAGE }, { status: 403 });
}
