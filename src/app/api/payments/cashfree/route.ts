import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { cashfreeRequest } from '@/lib/payments/cashfree';

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('agent');
    const { data, error } = await supabaseAdmin()
      .from('account_cashfree_connections')
      .select('client_id, environment, enabled')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ||
      new URL(request.url).origin;
    return NextResponse.json({
      connected: Boolean(data?.enabled),
      keyId: data?.client_id ?? '',
      environment: data?.environment ?? 'production',
      webhookUrl: `${origin}/api/payments/cashfree/webhook/${accountId}`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = await request.json();
    const clientId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
    const secret =
      typeof body.keySecret === 'string' ? body.keySecret.trim() : '';
    if (
      !clientId ||
      !secret ||
      !['production', 'sandbox'].includes(body.environment)
    )
      return NextResponse.json(
        { error: 'Enter a Cashfree App ID, Secret Key and environment.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const { count, error: pendingError } = await db
      .from('flow_payment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('config->>provider', 'cashfree')
      .in('status', ['creating', 'pending']);
    if (pendingError) throw pendingError;
    if (count)
      return NextResponse.json(
        {
          error:
            'Finish pending Cashfree collections before replacing the connection.',
        },
        { status: 409 }
      );
    // A nonexistent merchant link verifies authentication without creating a payable link.
    try {
      await cashfreeRequest(
        {
          client_id: clientId,
          client_secret: secret,
          environment: body.environment,
        },
        'links/connection_verification_missing'
      );
    } catch (err) {
      if (!(err instanceof Error) || !err.message.includes('(404)'))
        return NextResponse.json(
          {
            error:
              'Could not verify Cashfree credentials. Check the keys, environment and Payment Links access.',
          },
          { status: 400 }
        );
    }
    const { error } = await db
      .from('account_cashfree_connections')
      .upsert(
        {
          account_id: accountId,
          client_id: clientId,
          client_secret_encrypted: encrypt(secret),
          environment: body.environment,
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      );
    if (error) throw error;
    return NextResponse.json({ connected: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
