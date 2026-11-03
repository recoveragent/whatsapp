import { NextResponse } from 'next/server';
import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { promptTemplateError } from '@/lib/whatsapp/smart-retry';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    const db = supabaseAdmin();
    const [configs, settings, templates, recoveries] = await Promise.all([
      db
        .from('whatsapp_config')
        .select('id, reference_name, phone_number_id')
        .eq('account_id', ctx.accountId),
      db
        .from('smart_retry_settings')
        .select('*')
        .eq('account_id', ctx.accountId),
      db
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('status', 'APPROVED'),
      db
        .from('smart_retry_messages')
        .select(
          'id, recipient, status, error_message, created_at, expires_at, original_message_id, retry_message_id'
        )
        .eq('account_id', ctx.accountId)
        .neq('status', 'tracking')
        .order('created_at', { ascending: false })
        .limit(30),
    ]);
    for (const result of [configs, settings, templates, recoveries])
      if (result.error) throw result.error;
    return NextResponse.json({
      configs: configs.data,
      settings: settings.data,
      templates: templates.data?.filter(
        (t) => isMessageTemplate(t) && !promptTemplateError(t)
      ),
      recoveries: recoveries.data,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole('admin');
    const body = await request.json();
    if (
      typeof body.whatsapp_config_id !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(body.whatsapp_config_id) ||
      typeof body.enabled !== 'boolean' ||
      typeof body.company_name !== 'string' ||
      !body.company_name.trim() ||
      body.company_name.length > 100 ||
      (body.template_id != null &&
        (typeof body.template_id !== 'string' ||
          !/^[0-9a-f-]{36}$/i.test(body.template_id)))
    ) {
      return NextResponse.json(
        {
          error:
            'Choose a WhatsApp number, company name (up to 100 characters), and template.',
        },
        { status: 400 }
      );
    }
    const db = supabaseAdmin();
    const { data: config, error: configError } = await db
      .from('whatsapp_config')
      .select('id')
      .eq('account_id', ctx.accountId)
      .eq('id', body.whatsapp_config_id)
      .maybeSingle();
    if (configError) throw configError;
    if (!config)
      return NextResponse.json(
        { error: 'WhatsApp number not found' },
        { status: 404 }
      );
    if (body.template_id || body.enabled) {
      const { data: template } = await db
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('whatsapp_config_id', config.id)
        .eq('id', body.template_id ?? '')
        .maybeSingle();
      const reason = promptTemplateError(
        isMessageTemplate(template) ? template : null
      );
      if (reason) return NextResponse.json({ error: reason }, { status: 400 });
    }
    const { error } = await db.from('smart_retry_settings').upsert(
      {
        account_id: ctx.accountId,
        whatsapp_config_id: config.id,
        enabled: body.enabled,
        company_name: body.company_name.trim(),
        template_id: body.template_id || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'whatsapp_config_id' }
    );
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}
