import { NextResponse } from 'next/server';
import { requireSuperAdminBrand } from '@/lib/auth/super-admin';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';
import { validateAiCredentials } from '@/lib/ai/validate';
import { embedTexts } from '@/lib/ai/embeddings';
import { AiError } from '@/lib/ai/types';

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const { brand } = await requireSuperAdminBrand(id);
    const { data, error } = await supabaseAdmin()
      .from('ai_configs')
      .select('provider, model, api_key, embeddings_api_key')
      .eq('account_id', brand.id)
      .maybeSingle();
    if (error) throw error;
    return NextResponse.json(
      data
        ? {
            configured: true,
            provider: data.provider,
            model: data.model,
            has_key: !!data.api_key,
            has_embeddings_key: !!data.embeddings_api_key,
          }
        : { configured: false }
    );
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function POST(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const { brand, userId } = await requireSuperAdminBrand(id);
    const limit = checkRateLimit(`admin-ai:${userId}`, RATE_LIMITS.adminAction);
    if (!limit.success) return rateLimitResponse(limit);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      );
    const provider = body.provider;
    const model = typeof body.model === 'string' ? body.model.trim() : '';
    if (
      (provider !== 'openai' && provider !== 'anthropic') ||
      !model ||
      model.length > 200
    )
      return NextResponse.json(
        { error: 'Select a provider and enter a valid model ID.' },
        { status: 400 }
      );
    const db = supabaseAdmin();
    const { data: existing, error: readError } = await db
      .from('ai_configs')
      .select('provider, model, api_key')
      .eq('account_id', brand.id)
      .maybeSingle();
    if (readError) throw readError;
    const rawKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    if (!rawKey && existing?.provider !== provider)
      return NextResponse.json(
        { error: 'Enter a new API key when changing providers.' },
        { status: 400 }
      );
    let apiKey: string;
    try {
      apiKey = rawKey || (existing?.api_key ? decrypt(existing.api_key) : '');
    } catch {
      return NextResponse.json(
        { error: 'Stored key cannot be decrypted. Enter a new API key.' },
        { status: 400 }
      );
    }
    if (!apiKey)
      return NextResponse.json(
        { error: 'An API key is required.' },
        { status: 400 }
      );
    if (
      body.test_only === true ||
      rawKey ||
      !existing ||
      provider !== existing.provider ||
      model !== existing.model
    ) {
      await validateAiCredentials({
        provider,
        model,
        apiKey,
        systemPrompt: null,
        isActive: true,
        autoReplyEnabled: false,
        autoReplyMaxPerConversation: 3,
        handoffAgentId: null,
        embeddingsApiKey: null,
      });
    }
    const embeddingsKey =
      typeof body.embeddings_api_key === 'string'
        ? body.embeddings_api_key.trim()
        : '';
    if (embeddingsKey) await embedTexts(embeddingsKey, ['ping']);
    if (body.test_only === true) return NextResponse.json({ success: true });
    const patch: Record<string, unknown> = { provider, model };
    if (rawKey) patch.api_key = encrypt(rawKey);
    if (embeddingsKey) patch.embeddings_api_key = encrypt(embeddingsKey);
    else if (body.embeddings_api_key === null) patch.embeddings_api_key = null;
    const { error } = existing
      ? await db.from('ai_configs').update(patch).eq('account_id', brand.id)
      : await db.from('ai_configs').insert({
          ...patch,
          account_id: brand.id,
          created_by: userId,
          api_key: encrypt(apiKey),
          is_active: false,
          auto_reply_enabled: false,
        });
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AiError)
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: 400 }
      );
    return toErrorResponse(err);
  }
}

export async function DELETE(_request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const { brand } = await requireSuperAdminBrand(id);
    const { error } = await supabaseAdmin()
      .from('ai_configs')
      .delete()
      .eq('account_id', brand.id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
