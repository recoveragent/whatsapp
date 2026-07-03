import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { ForbiddenError, toErrorResponse, UnauthorizedError } from '@/lib/auth/account';
import {
  getOrgPaymentConfig,
  toPublicPaymentConfig,
  upsertOrgPaymentConfig,
} from '@/lib/wallet/payment-config';

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new UnauthorizedError();

  const { data: member } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!member?.organization_id) {
    throw new ForbiddenError('Super admin access required');
  }

  return { supabase, organizationId: member.organization_id as string };
}

export async function GET() {
  try {
    const { organizationId } = await requireSuperAdmin();
    const config = await getOrgPaymentConfig(organizationId);
    return NextResponse.json({
      config: toPublicPaymentConfig(config),
      webhookUrl: `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, '') ?? ''}/api/wallet/webhook/razorpay`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request) {
  try {
    const { organizationId } = await requireSuperAdmin();
    const body = (await request.json().catch(() => null)) as {
      keyId?: unknown;
      keySecret?: unknown;
      webhookSecret?: unknown;
      gstRate?: unknown;
      isEnabled?: unknown;
    } | null;

    const keyId = typeof body?.keyId === 'string' ? body.keyId.trim() : '';
    if (!keyId) {
      return NextResponse.json({ error: 'Razorpay Key ID is required' }, { status: 400 });
    }

    const gstRate = Number(body?.gstRate);
    const normalizedGst = Number.isFinite(gstRate) && gstRate >= 0 && gstRate <= 1
      ? gstRate
      : 0.18;

    await upsertOrgPaymentConfig({
      organizationId,
      keyId,
      keySecret: typeof body?.keySecret === 'string' ? body.keySecret : undefined,
      webhookSecret:
        typeof body?.webhookSecret === 'string' ? body.webhookSecret : undefined,
      gstRate: normalizedGst,
      isEnabled: Boolean(body?.isEnabled),
    });

    const config = await getOrgPaymentConfig(organizationId);
    return NextResponse.json({ config: toPublicPaymentConfig(config) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
