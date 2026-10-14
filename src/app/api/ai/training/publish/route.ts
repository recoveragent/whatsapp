import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('admin');
    const rate = checkRateLimit(
      `ai-training-publish:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!rate.success) return rateLimitResponse(rate);
    const body = await request.json().catch(() => null);
    if (!Number.isInteger(body?.revision) || body.revision < 1)
      return NextResponse.json(
        { error: 'Save the draft before publishing.' },
        { status: 400 }
      );
    const { data, error } = await supabase.rpc('publish_ai_training', {
      p_account_id: accountId,
      p_revision: body.revision,
      p_unpublish: body.unpublish === true,
    });
    if (error) {
      if (error.code === '40001')
        return NextResponse.json(
          { error: 'Training changed. Reload before publishing.' },
          { status: 409 }
        );
      if (error.code === '22023')
        return NextResponse.json(
          { error: 'Approve at least one answered question first.' },
          { status: 400 }
        );
      throw error;
    }
    return NextResponse.json({ success: true, document_id: data });
  } catch (error) {
    return toErrorResponse(error);
  }
}
