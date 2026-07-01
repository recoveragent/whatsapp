import { NextResponse } from 'next/server';

import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { ensureConversation, ensureShopifyContact } from '@/lib/shopify/ensure-contact';
import { isValidE164 } from '@/lib/whatsapp/phone-utils';

export async function POST(req: Request) {
  try {
    const ctx = await requireRole('agent');
    const body = (await req.json()) as { phone?: string; name?: string };

    const phone = String(body.phone ?? '').trim();
    const name = String(body.name ?? '').trim() || phone;

    if (!phone) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }

    if (!isValidE164(phone)) {
      return NextResponse.json(
        { error: 'Enter a valid phone number with country code (e.g. +37061234567)' },
        { status: 400 },
      );
    }

    const contact = await ensureShopifyContact(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      phone,
      name,
    );
    if (!contact) {
      return NextResponse.json({ error: 'Could not create contact' }, { status: 400 });
    }

    const conv = await ensureConversation(
      ctx.supabase,
      ctx.accountId,
      ctx.userId,
      contact.id,
    );
    if (!conv) {
      return NextResponse.json({ error: 'Could not create conversation' }, { status: 500 });
    }

    const { data, error } = await ctx.supabase
      .from('conversations')
      .select('*, contact:contacts(*)')
      .eq('id', conv.id)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: 'Failed to load conversation' }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    return toErrorResponse(err);
  }
}
