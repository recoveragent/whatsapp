import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';

export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const { data, error } = await supabase
      .from('ai_configs')
      .select(
        'provider, model, system_prompt, is_active, auto_reply_enabled, auto_reply_max_per_conversation, handoff_agent_id, api_key, embeddings_api_key'
      )
      .eq('account_id', accountId)
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Failed to load AI configuration' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json({
        configured: false,
        credentials_managed_by: 'super_admin',
      });
    const { api_key, embeddings_api_key, ...safe } = data;
    return NextResponse.json({
      configured: true,
      has_key: !!api_key,
      has_embeddings_key: !!embeddings_api_key,
      credentials_managed_by: 'super_admin',
      ...safe,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('admin');
    const limit = checkRateLimit(
      'ai-config:' + userId,
      RATE_LIMITS.adminAction
    );
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    if (
      [
        'provider',
        'model',
        'training_model',
        'api_key',
        'embeddings_api_key',
      ].some((field) => field in body)
    )
      return NextResponse.json(
        {
          error: 'AI provider, model and API keys are managed by super admin.',
        },
        { status: 403 }
      );
    const patch: Record<string, unknown> = {};
    if ('system_prompt' in body) {
      if (body.system_prompt !== null && typeof body.system_prompt !== 'string')
        return NextResponse.json(
          { error: 'Invalid system prompt' },
          { status: 400 }
        );
      patch.system_prompt = body.system_prompt?.trim() || null;
    }
    for (const field of ['is_active', 'auto_reply_enabled']) {
      if (field in body) {
        if (typeof body[field] !== 'boolean')
          return NextResponse.json(
            { error: field + ' must be a boolean' },
            { status: 400 }
          );
        patch[field] = body[field];
      }
    }
    if ('auto_reply_max_per_conversation' in body) {
      const max = Number(body.auto_reply_max_per_conversation);
      if (!Number.isInteger(max) || max < 1 || max > 20)
        return NextResponse.json(
          { error: 'Reply limit must be between 1 and 20' },
          { status: 400 }
        );
      patch.auto_reply_max_per_conversation = max;
    }
    if ('handoff_agent_id' in body) {
      const id = body.handoff_agent_id;
      if (id !== null && typeof id !== 'string')
        return NextResponse.json(
          { error: 'Invalid handoff agent' },
          { status: 400 }
        );
      const handoffId = id?.trim() || null;
      if (handoffId) {
        const { data: member, error } = await supabase
          .from('profiles')
          .select('user_id')
          .eq('account_id', accountId)
          .eq('user_id', handoffId)
          .maybeSingle();
        if (error || !member)
          return NextResponse.json(
            { error: 'Handoff agent must be a member of this brand' },
            { status: 400 }
          );
      }
      patch.handoff_agent_id = handoffId;
    }
    if (!Object.keys(patch).length)
      return NextResponse.json(
        { error: 'No behavior settings supplied' },
        { status: 400 }
      );
    const { data, error } = await supabase
      .from('ai_configs')
      .update(patch)
      .eq('account_id', accountId)
      .select('account_id')
      .maybeSingle();
    if (error)
      return NextResponse.json(
        { error: 'Failed to save AI behavior' },
        { status: 500 }
      );
    if (!data)
      return NextResponse.json(
        { error: 'Ask super admin to configure the AI model first.' },
        { status: 409 }
      );
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function DELETE() {
  try {
    await requireAiAgentsAccount('admin');
    return NextResponse.json(
      { error: 'Only super admin can remove AI model configuration.' },
      { status: 403 }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}
