import { NextResponse } from 'next/server';

import { getCurrentAccount, requireRole, toErrorResponse } from '@/lib/auth/account';
import {
  getMagicMessageSettings,
  upsertMagicMessageSettings,
} from '@/lib/inbox/magic-message-settings';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const settings = await getMagicMessageSettings(ctx.supabase, ctx.accountId);
    return NextResponse.json(settings);
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = (await request.json()) as {
      enabled?: boolean;
      template_name?: string;
      template_language?: string;
    };

    if (body.template_name != null && !String(body.template_name).trim()) {
      return NextResponse.json(
        { error: 'template_name cannot be empty' },
        { status: 400 },
      );
    }

    if (body.template_language != null && !String(body.template_language).trim()) {
      return NextResponse.json(
        { error: 'template_language cannot be empty' },
        { status: 400 },
      );
    }

    const settings = await upsertMagicMessageSettings(ctx.supabase, ctx.accountId, {
      enabled: body.enabled,
      template_name: body.template_name,
      template_language: body.template_language,
    });

    return NextResponse.json(settings);
  } catch (err) {
    return toErrorResponse(err);
  }
}
