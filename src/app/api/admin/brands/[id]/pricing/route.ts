import { NextResponse } from 'next/server';

import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { toErrorResponse } from '@/lib/auth/account';
import {
  MESSAGE_PRICING_CATEGORIES,
  type MessagePricingCategory,
  type MessagePricingRow,
} from '@/lib/wallet/types';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, brand } = await requireSuperAdminBrand(id);

    const { data: wallet } = await supabase
      .from('account_wallets')
      .select('balance_paise, currency')
      .eq('account_id', brand.id)
      .maybeSingle();

    const { data: pricing } = await supabase
      .from('account_message_pricing')
      .select('category, price_paise')
      .eq('account_id', brand.id);

    const pricingRows: MessagePricingRow[] = MESSAGE_PRICING_CATEGORIES.map((cat) => {
      const row = (pricing ?? []).find((p) => p.category === cat);
      return {
        category: cat,
        pricePaise: Number(row?.price_paise ?? 0),
      };
    });

    return NextResponse.json({
      brand: { id: brand.id, name: brand.name },
      balancePaise: Number(wallet?.balance_paise ?? 0),
      currency: (wallet?.currency as string) ?? 'INR',
      pricing: pricingRows,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const { supabase, brand } = await requireSuperAdminBrand(id);

    const body = (await request.json().catch(() => null)) as {
      pricing?: { category?: unknown; pricePaise?: unknown }[];
    } | null;

    const updates = body?.pricing ?? [];
    for (const row of updates) {
      const category = row.category as MessagePricingCategory;
      if (!MESSAGE_PRICING_CATEGORIES.includes(category)) continue;
      const pricePaise = Math.max(0, Math.round(Number(row.pricePaise) || 0));

      const { error } = await supabase
        .from('account_message_pricing')
        .upsert(
          {
            account_id: brand.id,
            category,
            price_paise: pricePaise,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'account_id,category' },
        );

      if (error) {
        console.error('[PUT /api/admin/brands/[id]/pricing]', error);
        return NextResponse.json({ error: 'Failed to save pricing' }, { status: 500 });
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
