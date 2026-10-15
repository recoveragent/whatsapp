import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit';
import { loadAiConfig } from '@/lib/ai/config';
import { crawlTrainingWebsite } from '@/lib/ai/training-crawl';
import { generateTrainingFaqs } from '@/lib/ai/training-generate';
import { mergeTrainingFaqs, validateTrainingEdits } from '@/lib/ai/training';
import type { TrainingSet } from '@/lib/ai/training-types';
import { AiError } from '@/lib/ai/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const [draft, shopify, woo] = await Promise.all([
      supabase
        .from('ai_training_sets')
        .select('*')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('shopify_config')
        .select('shop_domain, status')
        .eq('account_id', accountId)
        .maybeSingle(),
      supabase
        .from('woocommerce_config')
        .select('store_url, status')
        .eq('account_id', accountId)
        .maybeSingle(),
    ]);
    if (draft.error) throw draft.error;
    const connectedUrl =
      shopify.data?.status === 'connected'
        ? `https://${shopify.data.shop_domain}`
        : woo.data?.status === 'connected'
          ? woo.data.store_url
          : '';
    return NextResponse.json({
      training: draft.data,
      connected_url: connectedUrl,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount('admin');
    const rate = checkRateLimit(`ai-training:${accountId}`, {
      windowMs: 60_000,
      limit: 2,
    });
    if (!rate.success) return rateLimitResponse(rate);
    const raw = await request.text();
    if (raw.length > 5000)
      return NextResponse.json(
        { error: 'Request is too large.' },
        { status: 413 }
      );
    const body = JSON.parse(raw);
    if (
      !body ||
      typeof body.website_url !== 'string' ||
      body.website_url.length > 2000 ||
      !Number.isInteger(body.revision) ||
      body.revision < 0
    )
      return NextResponse.json(
        { error: 'Enter a website URL and current draft revision.' },
        { status: 400 }
      );
    const { data, error } = await supabase
      .from('ai_training_sets')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    const previous = data as TrainingSet | null;
    if ((previous?.revision ?? 0) !== body.revision)
      return NextResponse.json(
        { error: 'Training changed. Reload before scanning.' },
        { status: 409 }
      );
    const config = await loadAiConfig(supabase, accountId, {
      requireActive: false,
      purpose: 'training',
    });
    if (!config)
      return NextResponse.json(
        { error: 'Ask super admin to configure the AI model first.' },
        { status: 409 }
      );
    const scan = await crawlTrainingWebsite(body.website_url);
    const generated = await generateTrainingFaqs(config, scan.sources);
    const patch = {
      website_url: scan.websiteUrl,
      sources: scan.sources,
      faqs: mergeTrainingFaqs(previous?.faqs ?? [], generated.faqs),
      revision: body.revision + 1,
      updated_at: new Date().toISOString(),
    };
    const saved = previous
      ? await supabase
          .from('ai_training_sets')
          .update(patch)
          .eq('account_id', accountId)
          .eq('revision', body.revision)
          .select('*')
          .maybeSingle()
      : await supabase
          .from('ai_training_sets')
          .insert({ account_id: accountId, ...patch })
          .select('*')
          .single();
    if (saved.error?.code === '23505' || (!saved.error && !saved.data))
      return NextResponse.json(
        {
          error:
            'Training changed during scanning. Reload to keep the newer draft.',
        },
        { status: 409 }
      );
    if (saved.error) throw saved.error;
    return NextResponse.json({
      training: saved.data,
      warnings: scan.warnings,
      usage: generated.usage,
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Invalid request body.' },
        { status: 400 }
      );
    if (error instanceof AiError)
      return NextResponse.json({ error: error.message }, { status: 502 });
    // Safe, actionable crawl/generation failures; never include credentials.
    if (error instanceof Error && !('code' in error) && error.name === 'Error')
      return NextResponse.json({ error: error.message }, { status: 400 });
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { supabase, accountId, userId } =
      await requireAiAgentsAccount('admin');
    const rate = checkRateLimit(
      `ai-training-save:${userId}`,
      RATE_LIMITS.adminAction
    );
    if (!rate.success) return rateLimitResponse(rate);
    const raw = await request.text();
    if (raw.length > 500_000)
      return NextResponse.json(
        { error: 'Training draft is too large.' },
        { status: 413 }
      );
    const body = JSON.parse(raw);
    if (!Number.isInteger(body?.revision) || body.revision < 1)
      return NextResponse.json(
        { error: 'Invalid draft revision.' },
        { status: 400 }
      );
    const { data, error } = await supabase
      .from('ai_training_sets')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error) throw error;
    const current = data as TrainingSet | null;
    if (!current || current.revision !== body.revision)
      return NextResponse.json(
        {
          error: 'Training changed. Reload to avoid overwriting another edit.',
        },
        { status: 409 }
      );
    const faqs = validateTrainingEdits(body.faqs, current.faqs);
    const saved = await supabase
      .from('ai_training_sets')
      .update({
        faqs,
        revision: body.revision + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('account_id', accountId)
      .eq('revision', body.revision)
      .select('*')
      .maybeSingle();
    if (saved.error) throw saved.error;
    if (!saved.data)
      return NextResponse.json(
        { error: 'Training changed. Reload and retry.' },
        { status: 409 }
      );
    return NextResponse.json({ training: saved.data });
  } catch (error) {
    if (error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Invalid request body.' },
        { status: 400 }
      );
    if (error instanceof Error && !('code' in error) && error.name === 'Error')
      return NextResponse.json({ error: error.message }, { status: 400 });
    return toErrorResponse(error);
  }
}
