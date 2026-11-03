import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  MAX_INSTRUCTION_LENGTH,
  REPLY_GUIDANCE_COLUMNS,
} from '@/lib/ai/reply-guidance';

export const runtime = 'nodejs';

/** Edit the instruction and/or switch a correction on or off. */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireAiAgentsAccount('admin');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object')
      return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });

    const update: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if ('instruction' in body) {
      const instruction =
        typeof body.instruction === 'string' ? body.instruction.trim() : '';
      if (!instruction || instruction.length > MAX_INSTRUCTION_LENGTH)
        return NextResponse.json(
          {
            error: `The instruction must be 1–${MAX_INSTRUCTION_LENGTH} characters.`,
          },
          { status: 400 }
        );
      update.instruction = instruction;
    }
    if ('is_active' in body) {
      if (typeof body.is_active !== 'boolean')
        return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
      update.is_active = body.is_active;
    }

    const { data, error } = await supabase
      .from('ai_reply_guidance')
      .update(update)
      .eq('id', id)
      .eq('account_id', accountId)
      .select(REPLY_GUIDANCE_COLUMNS)
      .maybeSingle();
    if (error) throw error;
    if (!data)
      return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    return NextResponse.json({ guidance: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { supabase, accountId } = await requireAiAgentsAccount('admin');
    const { error } = await supabase
      .from('ai_reply_guidance')
      .delete()
      .eq('id', id)
      .eq('account_id', accountId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
