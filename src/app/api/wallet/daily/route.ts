import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import type { WalletDailyRow } from '@/lib/wallet/types';

export async function GET(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    const { searchParams } = new URL(request.url);

    const typeFilter = searchParams.get('type');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    let query = ctx.supabase
      .from('wallet_transactions')
      .select('created_at, type, amount_paise, balance_after_paise')
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false });

    if (typeFilter === 'credit' || typeFilter === 'debit') {
      query = query.eq('type', typeFilter);
    }
    if (from) query = query.gte('created_at', from);
    if (to) query = query.lte('created_at', to);

    const { data, error } = await query;
    if (error) {
      console.error('[GET /api/wallet/daily]', error);
      return NextResponse.json({ error: 'Failed to load daily summary' }, { status: 500 });
    }

    const byDay = new Map<string, WalletDailyRow>();

    for (const row of data ?? []) {
      const d = new Date(row.created_at as string);
      const key = d.toISOString().slice(0, 10);
      const existing = byDay.get(key) ?? {
        date: key,
        transactionCount: 0,
        creditPaise: 0,
        debitPaise: 0,
        balanceAfterPaise: 0,
      };
      existing.transactionCount += 1;
      if (row.type === 'credit') {
        existing.creditPaise += Number(row.amount_paise);
      } else {
        existing.debitPaise += Number(row.amount_paise);
      }
      existing.balanceAfterPaise = Number(row.balance_after_paise);
      byDay.set(key, existing);
    }

    const daily = Array.from(byDay.values()).sort((a, b) =>
      b.date.localeCompare(a.date),
    );

    return NextResponse.json({ daily });
  } catch (err) {
    return toErrorResponse(err);
  }
}
