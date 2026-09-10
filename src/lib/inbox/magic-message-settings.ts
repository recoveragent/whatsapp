import type { SupabaseClient } from '@supabase/supabase-js';

import type { InboxMagicMessageSettings, MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';

export const DEFAULT_MAGIC_MESSAGE_TEMPLATE_NAME = 'magic_message';
export const DEFAULT_MAGIC_MESSAGE_TEMPLATE_LANGUAGE = 'en_US';

export type MagicMessageSettingsResponse = InboxMagicMessageSettings & {
  template_ready: boolean;
  template_status: MessageTemplate['status'] | null;
};

export async function getMagicMessageSettings(
  supabase: SupabaseClient,
  accountId: string,
): Promise<MagicMessageSettingsResponse> {
  const { data } = await supabase
    .from('inbox_magic_message_settings')
    .select('*')
    .eq('account_id', accountId)
    .maybeSingle();

  const settings: InboxMagicMessageSettings = data
    ? (data as InboxMagicMessageSettings)
    : {
        account_id: accountId,
        enabled: true,
        template_name: DEFAULT_MAGIC_MESSAGE_TEMPLATE_NAME,
        template_language: DEFAULT_MAGIC_MESSAGE_TEMPLATE_LANGUAGE,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

  const { data: templateRow } = await supabase
    .from('message_templates')
    .select('status, header_type, category')
    .eq('account_id', accountId)
    .eq('name', settings.template_name)
    .eq('language', settings.template_language)
    .maybeSingle();

  const templateReady =
    templateRow?.category === 'Utility' &&
    templateRow?.header_type === 'image' &&
    templateRow?.status === 'APPROVED';

  return {
    ...settings,
    template_ready: Boolean(templateReady),
    template_status:
      (templateRow?.status as MessageTemplate['status'] | undefined) ?? null,
  };
}

export async function upsertMagicMessageSettings(
  supabase: SupabaseClient,
  accountId: string,
  patch: {
    enabled?: boolean;
    template_name?: string;
    template_language?: string;
  },
): Promise<MagicMessageSettingsResponse> {
  const existing = await getMagicMessageSettings(supabase, accountId);

  const enabled = patch.enabled ?? existing.enabled;
  const template_name = (patch.template_name ?? existing.template_name).trim();
  const template_language = (
    patch.template_language ?? existing.template_language
  ).trim();

  if (!template_name) {
    throw new Error('template_name is required');
  }
  if (!template_language) {
    throw new Error('template_language is required');
  }

  const { data, error } = await supabase
    .from('inbox_magic_message_settings')
    .upsert(
      {
        account_id: accountId,
        enabled,
        template_name,
        template_language,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_id' },
    )
    .select('*')
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to save Magic Message settings');
  }

  return getMagicMessageSettings(supabase, accountId);
}

export async function loadMagicMessageTemplate(
  supabase: SupabaseClient,
  accountId: string,
  settings: Pick<InboxMagicMessageSettings, 'template_name' | 'template_language'>,
): Promise<MessageTemplate> {
  const { data, error } = await supabase
    .from('message_templates')
    .select('*')
    .eq('account_id', accountId)
    .eq('name', settings.template_name)
    .eq('language', settings.template_language)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!data || !isMessageTemplate(data)) {
    throw new Error(
      'Magic Message utility template not found locally — sync templates from Meta or push the magic_message preset.',
    );
  }
  if (data.status !== 'APPROVED') {
    throw new Error(
      `Magic Message template is ${data.status.toLowerCase()} — it must be APPROVED before use.`,
    );
  }
  if (data.category !== 'Utility') {
    throw new Error('Magic Message template must be a Utility category template.');
  }
  if (data.header_type !== 'image') {
    throw new Error('Magic Message template must have an image header.');
  }

  return data;
}
