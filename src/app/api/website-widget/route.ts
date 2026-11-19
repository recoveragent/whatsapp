import { NextResponse } from 'next/server';
import { requireAiAgentsAccount, toErrorResponse } from '@/lib/auth/account';
import {
  normalizeWidgetDomain,
  WIDGET_MAX_DOMAINS,
} from '@/lib/website-widget/config';
import {
  coercePageRules,
  parsePageRules,
  type PageRules,
} from '@/lib/website-widget/page-rules';

const SETTINGS_COLUMNS =
  'public_key, enabled, desktop_side_offset, desktop_bottom_offset, mobile_side_offset, mobile_bottom_offset, desktop_position, mobile_position, allowed_domains, title, greeting, launcher_greeting_enabled, launcher_greeting_text, launcher_greeting_delay, launcher_indicator, avatar_url, show_whatsapp_link, suggested_questions, accent_color, whatsapp_number, daily_reply_limit, page_rules, replies_today, replies_day';

interface SettingsRow {
  public_key: string;
  enabled: boolean;
  desktop_side_offset: number;
  desktop_bottom_offset: number;
  mobile_side_offset: number;
  mobile_bottom_offset: number;
  desktop_position: 'left' | 'right';
  mobile_position: 'left' | 'right';
  allowed_domains: string[];
  title: string;
  greeting: string;
  launcher_greeting_enabled: boolean;
  launcher_greeting_text: string;
  launcher_greeting_delay: number;
  launcher_indicator: 'dot' | 'number';
  avatar_url: string | null;
  show_whatsapp_link: boolean;
  suggested_questions: string[];
  accent_color: string;
  whatsapp_number: string | null;
  daily_reply_limit: number;
  page_rules: PageRules;
  replies_today: number;
  replies_day: string | null;
}

/** The counter only resets on the next claim, so ignore an earlier day's. */
function toPayload(row: SettingsRow) {
  const { replies_today, replies_day, ...settings } = row;
  const today = new Date().toISOString().slice(0, 10);
  return { ...settings, page_rules: coercePageRules(settings.page_rules), replies_used_today: replies_day === today ? replies_today : 0 };
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
    const desktopPosition = body.desktop_position ?? 'right';
    const mobilePosition = body.mobile_position ?? 'right';
    if (!['left', 'right'].includes(desktopPosition) || !['left', 'right'].includes(mobilePosition))
      return invalid('Invalid chat bubble position');

    const offsets = {
      desktop_side_offset: body.desktop_side_offset ?? 20,
      desktop_bottom_offset: body.desktop_bottom_offset ?? 20,
      mobile_side_offset: body.mobile_side_offset ?? 16,
      mobile_bottom_offset: body.mobile_bottom_offset ?? 16,
    };
    if (Object.values(offsets).some((offset) => !Number.isInteger(offset) || (offset as number) < 0 || (offset as number) > 200))
      return invalid('Bubble offsets must be whole numbers from 0 to 200 pixels');

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

    const launcherGreetingEnabled = body.launcher_greeting_enabled ?? false;
    const launcherGreetingText = typeof body.launcher_greeting_text === 'string' ? body.launcher_greeting_text.trim() : 'Hi! How can I help?';
    const launcherGreetingDelay = body.launcher_greeting_delay ?? 5;
    const launcherIndicator = body.launcher_indicator ?? 'dot';
    if (typeof launcherGreetingEnabled !== 'boolean') return invalid('Invalid greeting setting');
    if (launcherGreetingText.length < 1 || launcherGreetingText.length > 120) return invalid('Launcher greeting must be 1 to 120 characters');
    if (!Number.isInteger(launcherGreetingDelay) || launcherGreetingDelay < 0 || launcherGreetingDelay > 300) return invalid('Greeting delay must be between 0 and 300 seconds');
    if (!['dot', 'number'].includes(launcherIndicator)) return invalid('Invalid launcher indicator');

    const avatarUrl = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : '';
    if (avatarUrl) {
      try {
        if (new URL(avatarUrl).protocol !== 'https:') return invalid('Photo URL must use HTTPS');
      } catch { return invalid('Enter a valid photo URL'); }
      if (avatarUrl.length > 2048) return invalid('Photo URL is too long');
    }
    if (typeof body.show_whatsapp_link !== 'boolean') return invalid('Invalid WhatsApp link setting');
    if (!Array.isArray(body.suggested_questions) || body.suggested_questions.length > 5 ||
        body.suggested_questions.some((question: unknown) => typeof question !== 'string' || !question.trim() || question.trim().length > 100))
      return invalid('Add up to 5 questions, each between 1 and 100 characters');
    const suggestedQuestions = body.suggested_questions.map((question: string) => question.trim());

    const accent = body.accent_color;
    if (typeof accent !== 'string' || !/^#[0-9a-f]{6}$/i.test(accent))
      return invalid('Colour must look like #128C7E');

    const whatsapp =
      typeof body.whatsapp_number === 'string'
        ? body.whatsapp_number.replace(/\D/g, '')
        : '';
    if (whatsapp && !/^[0-9]{8,15}$/.test(whatsapp))
      return invalid('Enter the WhatsApp number with its country code');
    if (body.enabled && !whatsapp)
      return invalid('Add a WhatsApp number before turning the widget on');

    const limit = body.daily_reply_limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100000)
      return invalid('Daily reply limit must be between 1 and 100000');

    const pageRules = parsePageRules(body.page_rules);
    if (typeof pageRules === 'string') return invalid(pageRules);

    const { data, error } = await supabase
      .from('website_widget_config')
      .upsert(
        {
          account_id: accountId,
          enabled: body.enabled,
          ...offsets,
          desktop_position: desktopPosition,
          mobile_position: mobilePosition,
          allowed_domains: [...domains],
          title,
          greeting,
          launcher_greeting_enabled: launcherGreetingEnabled,
          launcher_greeting_text: launcherGreetingText,
          launcher_greeting_delay: launcherGreetingDelay,
          launcher_indicator: launcherIndicator,
          avatar_url: avatarUrl || null,
          show_whatsapp_link: body.show_whatsapp_link,
          suggested_questions: suggestedQuestions,
          accent_color: accent,
          whatsapp_number: whatsapp || null,
          daily_reply_limit: limit,
          page_rules: pageRules,
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
