import { NextResponse } from 'next/server';

import { requireLeadGenAccount, toErrorResponse } from '@/lib/auth/account';
import { encrypt } from '@/lib/whatsapp/encryption';

interface SourceBody {
  id?: string;
  name?: string;
  page_id?: string;
  form_id?: string | null;
  access_token?: string;
  cadence_id?: string | null;
  pipeline_id?: string;
  stage_id?: string;
  default_language?: string;
  active?: boolean;
}

export async function GET(request: Request) {
  try {
    const ctx = await requireLeadGenAccount();
    const [{ data: sources, error }, { data: cadences }, { data: pipelines }] =
      await Promise.all([
        ctx.supabase
          .from('meta_lead_sources')
          .select(
            'id, name, page_id, form_id, cadence_id, pipeline_id, stage_id, default_language, active, created_at, updated_at'
          )
          .eq('account_id', ctx.accountId)
          .order('created_at', { ascending: true }),
        ctx.supabase
          .from('cadences')
          .select('id, name')
          .eq('account_id', ctx.accountId)
          .order('name'),
        ctx.supabase
          .from('pipelines')
          .select('id, name, pipeline_stages(id, name, position)')
          .eq('account_id', ctx.accountId)
          .order('created_at'),
      ]);
    if (error) throw error;
    const origin = new URL(request.url).origin;
    return NextResponse.json({
      sources: sources ?? [],
      cadences: cadences ?? [],
      pipelines: pipelines ?? [],
      callback_url: `${origin}/api/meta/leads/webhook`,
      verify_token_configured: Boolean(process.env.META_LEADS_VERIFY_TOKEN),
      app_secret_configured: Boolean(process.env.META_APP_SECRET),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireLeadGenAccount('admin');
    const body = (await request.json()) as SourceBody;
    const name = body.name?.trim() ?? '';
    const pageId = body.page_id?.trim() ?? '';
    const formId = body.form_id?.trim() || null;
    const pipelineId = body.pipeline_id?.trim() ?? '';
    const stageId = body.stage_id?.trim() ?? '';
    const cadenceId = body.cadence_id?.trim() || null;
    if (!name || !pageId || !pipelineId || !stageId) {
      return NextResponse.json(
        { error: 'Name, Page ID, pipeline, and New Lead stage are required' },
        { status: 400 }
      );
    }

    const [{ data: pipeline }, { data: stage }, cadenceResult] =
      await Promise.all([
        ctx.supabase
          .from('pipelines')
          .select('id')
          .eq('id', pipelineId)
          .eq('account_id', ctx.accountId)
          .maybeSingle(),
        ctx.supabase
          .from('pipeline_stages')
          .select('id, pipeline_id')
          .eq('id', stageId)
          .maybeSingle(),
        cadenceId
          ? ctx.supabase
              .from('cadences')
              .select('id')
              .eq('id', cadenceId)
              .eq('account_id', ctx.accountId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);
    if (!pipeline || !stage || stage.pipeline_id !== pipelineId) {
      return NextResponse.json(
        { error: 'Invalid pipeline or stage' },
        { status: 400 }
      );
    }
    if (cadenceId && !cadenceResult.data) {
      return NextResponse.json({ error: 'Invalid cadence' }, { status: 400 });
    }

    const base = {
      account_id: ctx.accountId,
      user_id: ctx.userId,
      name,
      page_id: pageId,
      form_id: formId,
      cadence_id: cadenceId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      default_language: body.default_language === 'hi' ? 'hi' : 'en',
      active: body.active !== false,
    };

    if (body.id) {
      const patch: Record<string, unknown> = { ...base };
      if (body.access_token?.trim())
        patch.access_token = encrypt(body.access_token.trim());
      const { data, error } = await ctx.supabase
        .from('meta_lead_sources')
        .update(patch)
        .eq('id', body.id)
        .eq('account_id', ctx.accountId)
        .select('id')
        .single();
      if (error) throw error;
      return NextResponse.json({ source: data });
    }

    if (!body.access_token?.trim()) {
      return NextResponse.json(
        { error: 'Page access token is required' },
        { status: 400 }
      );
    }
    const { data, error } = await ctx.supabase
      .from('meta_lead_sources')
      .insert({ ...base, access_token: encrypt(body.access_token.trim()) })
      .select('id')
      .single();
    if (error) throw error;
    return NextResponse.json({ source: data }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireLeadGenAccount('admin');
    const id = new URL(request.url).searchParams.get('id');
    if (!id)
      return NextResponse.json(
        { error: 'Source ID is required' },
        { status: 400 }
      );
    const { error } = await ctx.supabase
      .from('meta_lead_sources')
      .delete()
      .eq('id', id)
      .eq('account_id', ctx.accountId);
    if (error) throw error;
    return NextResponse.json({ deleted: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
