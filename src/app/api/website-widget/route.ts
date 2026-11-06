import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  normalizeWidgetDomain,
  WIDGET_MAX_DOMAINS,
} from '@/lib/website-widget/config';

const SETTINGS_COLUMNS =
  'public_key, enabled, allowed_domains, title, greeting, accent_color, whatsapp_number, daily_reply_limit, replies_today, replies_day';

interface SettingsRow {
  public_key: string;
  enabled: boolean;
  allowed_domains: string[];
  title: string;
  greeting: string;
  accent_color: string;
  whatsapp_number: string | null;
  daily_reply_limit: number;
  replies_today: number;
  replies_day: string | null;
}

/** The counter only resets on the next claim, so ignore an earlier day's. */
function toPayload(row: SettingsRow) {
  const { replies_today, replies_day, ...settings } = row;
  const today = new Date().toISOString().slice(0, 10);
  return { ...settings, replies_used_today: replies_day === today ? replies_today : 0 };
}

const invalid = (error: string) =>
  NextResponse.json({ error }, { status: 400 });

/** GET /api/website-widget — `settings` is null until first saved. */
export async function GET() {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount();
    const { data, error } = await supabase
      .from('website_widget_config')
      .select(SETTINGS_COLUMNS)
      .eq('account_id', accountId)
      .maybeSingle<SettingsRow>();
    if (error) {
      console.error('[website-widget] load failed:', error);
      return NextResponse.json(
        { error: 'Failed to load widget settings' },
        { status: 500 }
      );
    }
    return NextResponse.json({ settings: data ? toPayload(data) : null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** PATCH /api/website-widget (admin+) — saves the whole form. */
export async function PATCH(request: Request) {
  try {
    const { supabase, accountId } = await requireAiAgentsAccount('admin');
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return invalid('Invalid request');

    if (typeof body.enabled !== 'boolean') return invalid('Invalid request');

    if (!Array.isArray(body.allowed_domains)) return invalid('Invalid request');
    const domains = new Set<string>();
    for (const raw of body.allowed_domains) {
      const domain = typeof raw === 'string' ? normalizeWidgetDomain(raw) : null;
      if (!domain) return invalid(`"${String(raw).slice(0, 80)}" is not a valid domain`);
      domains.add(domain);
    }
    if (domains.size > WIDGET_MAX_DOMAINS)
      return invalid(`Add at most ${WIDGET_MAX_DOMAINS} domains`);
    if (body.enabled && domains.size === 0)
      return invalid('Add your website domain before turning the widget on');

    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (title.length < 1 || title.length > 60)
      return invalid('Title must be 1 to 60 characters');

    const greeting = typeof body.greeting === 'string' ? body.greeting.trim() : '';
    if (greeting.length < 1 || greeting.length > 300)
      return invalid('Greeting must be 1 to 300 characters');

    const accent = body.accent_color;
    if (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent))
      return invalid('Colour must look like #128C7E');

    const whatsapp =
      typeof body.whatsapp_number === 'string'
        ? body.whatsapp_number.replace(/\D/g, '')
        : '';
    if (whatsapp && !/^[0-9]{8,15}$/.test(whatsapp))
      return invalid('Enter the WhatsApp number with its country code');

    const limit = body.daily_reply_limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000)
      return invalid('Daily reply limit must be between 1 and 100000');

    const { data, error } = await supabase
      .from('website_widget_config')
      .upsert(
        {
          account_id: accountId,
          enabled: body.enabled,
          allowed_domains: [...domains],
          title,
          greeting,
          accent_color: accent,
          whatsapp_number: whatsapp || null,
          daily_reply_limit: limit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'account_id' }
      )
      .select(SETTINGS_COLUMNS)
      .single<SettingsRow>();
    if (error) {
      console.error('[website-widget] save failed:', error);
      return NextResponse.json(
        { error: 'Failed to save widget settings' },
        { status: 500 }
      );
    }
    return NextResponse.json({ settings: toPayload(data) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
