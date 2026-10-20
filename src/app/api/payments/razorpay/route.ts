import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { razorpayRequest } from '@/lib/payments/razorpay';
import { paymentSetupError } from '@/lib/payments/setup-errors';

function connectionErrorResponse(error: unknown) {
  const setupError = paymentSetupError(error);
  if (setupError) return NextResponse.json({ error: setupError, code: 'payment_setup_required' }, { status: 503 });
  return toErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    const { accountId } = await requireRole('agent');
    const { data, error } = await supabaseAdmin()
      .from('account_payment_connections')
      .select('key_id, enabled')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ||
      new URL(request.url).origin;
    return NextResponse.json({
      connected: Boolean(data?.enabled),
      keyId: data?.key_id ?? '',
      webhookUrl: `${origin}/api/payments/razorpay/webhook/${accountId}`,
    });
  } catch (err) {
    return connectionErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { accountId } = await requireRole('admin');
    const body = await request.json();
    const keyId = typeof body.keyId === 'string' ? body.keyId.trim() : '';
    const keySecret =
      typeof body.keySecret === 'string' ? body.keySecret.trim() : '';
    const webhookSecret =
      typeof body.webhookSecret === 'string' ? body.webhookSecret.trim() : '';
    if (
      !/^rzp_(test|live)_[a-zA-Z0-9]+$/.test(keyId) ||
      !keySecret ||
      webhookSecret.length < 16
    )
      return NextResponse.json(
        {
          error:
            'Enter a Razorpay Key ID, Key Secret, and a webhook secret of at least 16 characters.',
        },
        { status: 400 }
      );
    const db = supabaseAdmin();
    // Do not invalidate credentials or webhook verification for in-flight links.
    const { count, error: pendingError } = await db
      .from('flow_payment_requests')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .or('config->>provider.eq.razorpay,config->>provider.is.null')
      .in('status', ['creating', 'pending']);
    if (pendingError) throw pendingError;
    if (count)
      return NextResponse.json(
        {
          error:
            'Finish pending payment collections before replacing the connection.',
        },
        { status: 409 }
      );
    try {
      await razorpayRequest(
        { key_id: keyId, key_secret: keySecret },
        'payment_links?count=1'
      );
    } catch {
      return NextResponse.json(
        {
          error:
            'Could not verify Razorpay credentials. Check the keys and Payment Links access.',
        },
        { status: 400 }
      );
    }
    const { error } = await db
      .from('account_payment_connections')
      .upsert(
        {
          account_id: accountId,
          key_id: keyId,
          key_secret_encrypted: encrypt(keySecret),
          webhook_secret_encrypted: encrypt(webhookSecret),
          enabled: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      );
    if (error) throw error;
    return NextResponse.json({ connected: true });
  } catch (err) {
    return connectionErrorResponse(err);
  }
}
