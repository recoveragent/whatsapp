import type { SupabaseClient } from '@supabase/supabase-js';

import {
  listMergedAdminTemplatePresets,
  type AdminTemplatePresetView,
} from './admin-template-preset-store';

/**
 * Gallery templates a super admin marked as "default". Every brand in
 * the organization sees them in its Template library, waiting for
 * review, until the brand submits a template with the same name.
 */

function isMissingTableError(error: { code?: string } | null): boolean {
  // 42P01: undefined_table (migration not applied yet).
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function listDefaultTemplateSlugs(
  client: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  const { data, error } = await client
    .from('admin_template_defaults')
    .select('slug')
    .eq('organization_id', organizationId);

  if (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
  return (data ?? []).map((row) => row.slug as string);
}

export async function setDefaultTemplate(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  slug: string,
  isDefault: boolean,
): Promise<void> {
  if (isDefault) {
    const { error } = await client.from('admin_template_defaults').upsert(
      { organization_id: organizationId, slug, created_by: userId },
      { onConflict: 'organization_id,slug', ignoreDuplicates: true },
    );
    if (error) throw error;
    return;
  }

  const { error } = await client
    .from('admin_template_defaults')
    .delete()
    .eq('organization_id', organizationId)
    .eq('slug', slug);
  if (error) throw error;
}

export interface LibraryTemplate {
  slug: string;
  title: string;
  description: string;
  preset: AdminTemplatePresetView;
}

/**
 * Default templates for a brand's organization, minus the ones the
 * brand already has (matched by template name + language).
 *
 * `client` must be able to read the organization's presets and the
 * brand's templates — callers pass the service-role client.
 */
export async function listPendingLibraryTemplates(
  client: SupabaseClient,
  organizationId: string,
  accountId: string,
): Promise<LibraryTemplate[]> {
  const slugs = await listDefaultTemplateSlugs(client, organizationId);
  if (slugs.length === 0) return [];

  const presets = await listMergedAdminTemplatePresets(client, organizationId);
  const defaults = presets.filter((preset) => slugs.includes(preset.slug));
  if (defaults.length === 0) return [];

  const { data: existing, error } = await client
    .from('message_templates')
    .select('name, language')
    .eq('account_id', accountId)
    .in(
      'name',
      defaults.map((preset) => preset.name),
    );
  if (error) throw error;

  const taken = new Set(
    (existing ?? []).map(
      (row) => `${row.name as string}::${(row.language as string | null) ?? 'en_US'}`,
    ),
  );

  return defaults
    .filter(
      (preset) => !taken.has(`${preset.name}::${preset.language || 'en_US'}`),
    )
    .map((preset) => ({
      slug: preset.slug,
      title: preset.title,
      description: preset.description,
      preset,
    }));
}
