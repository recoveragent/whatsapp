import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { checkoutVariablePayload } from '@/lib/flows/recent-checkout-variables';

/** Recent saved abandoned checkouts, shaped like `vars.shopify_order` for checkout triggers. */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const { data, error } = await supabaseAdmin()
      .from('shopify_pending_checkouts')
      .select('checkout_id, payload, created_at')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    const checkouts = (data ?? []).map((saved) => ({
      checkout_id: saved.checkout_id,
      created_at: saved.created_at,
      payload: checkoutVariablePayload(saved.payload),
    }));
    return NextResponse.json(
      { checkouts },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
