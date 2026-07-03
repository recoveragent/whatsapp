import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { WalletTransaction, WalletTransactionType } from '@/lib/wallet/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);

    const typeFilter = searchParams.get('type') as WalletTransactionType | 'all' | null;
    const from = searchParams.get('from');
    const to = searchParams.get('to');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 200);
    const offset = parseInt(searchParams.get('offset') ?? '0', 10) || 0;

    let query = ctx.supabase
      .from('wallet_transactions')
      .select('*', { count: 'exact' })
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (typeFilter === 'credit' || typeFilter === 'debit') {
      query = query.eq('type', typeFilter);
    }
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error, count } = await query;
    if (error) {
      console.error('[GET /api/wallet/transactions]', error);
      return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
    }

    const transactions: WalletTransaction[] = (data ?? []).map((r) => ({
      id: r.id as string,
      type: r.type as WalletTransactionType,
      amountPaise: Number(r.amount_paise),
      gstPaise: Number(r.gst_paise ?? 0),
      balanceAfterPaise: Number(r.balance_after_paise),
      category: (r.category as WalletTransaction['category']) ?? null,
      referenceType: r.reference_type as string,
      referenceId: (r.reference_id as string) ?? null,
      description: (r.description as string) ?? '',
      status: (r.status as string) ?? 'completed',
      createdAt: r.created_at as string,
    }));

    return NextResponse.json({ transactions, total: count ?? 0, limit, offset });
  } catch (err) {
    return toErrorResponse(err);
  }
}
