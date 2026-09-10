import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageTemplate, TemplateButton } from '@/types';

import {
  getAdminTemplatePreset,
  isBuiltinPresetSlug,
  listAdminTemplatePresets,
  type AdminTemplatePreset,
} from './admin-template-presets';
import {
  validateBody,
  validateButtons,
  validateFooter,
  validateHeader,
  validateSampleValues,
  validateTemplateName,
  type TemplatePayload,
} from './template-validators';

export interface AdminTemplatePresetPayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: 'none' | 'text' | 'image' | 'video' | 'document';
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

export interface AdminTemplatePresetView extends AdminTemplatePreset {
  has_override: boolean;
  is_custom: boolean;
}

interface PresetRow {
  slug: string;
  title: string | null;
  description: string | null;
  payload: AdminTemplatePresetPayload;
  updated_at: string;
  is_custom: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parsePresetPayload(raw: unknown): AdminTemplatePresetPayload | null {
  if (!isRecord(raw)) return null;
  const headerFormat = raw.header_format;
  if (
    headerFormat !== 'none' &&
    headerFormat !== 'text' &&
    headerFormat !== 'image' &&
    headerFormat !== 'video' &&
    headerFormat !== 'document'
  ) {
    return null;
  }
  const category = raw.category;
  if (category !== 'Marketing' && category !== 'Utility') return null;
  if (typeof raw.name !== 'string' || typeof raw.body_text !== 'string') {
    return null;
  }
  return {
    name: raw.name,
    category,
    language: typeof raw.language === 'string' ? raw.language : 'en_US',
    header_format: headerFormat,
    header_content:
      typeof raw.header_content === 'string' ? raw.header_content : '',
    header_media_url:
      typeof raw.header_media_url === 'string' ? raw.header_media_url : '',
    header_sample:
      typeof raw.header_sample === 'string' ? raw.header_sample : '',
    body_text: raw.body_text,
    body_samples: Array.isArray(raw.body_samples)
      ? raw.body_samples.filter((v): v is string => typeof v === 'string')
      : [],
    footer_text: typeof raw.footer_text === 'string' ? raw.footer_text : '',
    buttons: Array.isArray(raw.buttons)
      ? (raw.buttons as TemplateButton[])
      : [],
  };
}

function mergeBuiltinPreset(
  base: AdminTemplatePreset,
  override: PresetRow | null,
): AdminTemplatePresetView {
  if (!override) {
    return { ...base, has_override: false, is_custom: false };
  }
  const payload = parsePresetPayload(override.payload);
  if (!payload) {
    return { ...base, has_override: false, is_custom: false };
  }
  return {
    ...base,
    ...payload,
    title: override.title?.trim() || base.title,
    description: override.description?.trim() || base.description,
    buttons: [...payload.buttons],
    body_samples: [...payload.body_samples],
    has_override: true,
    is_custom: false,
  };
}

function customRowToPreset(row: PresetRow): AdminTemplatePresetView | null {
  const payload = parsePresetPayload(row.payload);
  if (!payload || !row.title?.trim()) return null;
  return {
    slug: row.slug,
    title: row.title.trim(),
    description: row.description?.trim() || '',
    icon: 'custom',
    name: payload.name,
    category: payload.category,
    language: payload.language,
    header_format: payload.header_format,
    header_content: payload.header_content,
    header_media_url: payload.header_media_url,
    header_sample: payload.header_sample,
    body_text: payload.body_text,
    body_samples: [...payload.body_samples],
    footer_text: payload.footer_text,
    buttons: [...payload.buttons],
    has_override: false,
    is_custom: true,
  };
}

export async function listMergedAdminTemplatePresets(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AdminTemplatePresetView[]> {
  const { data, error } = await supabase
    .from('admin_template_preset_overrides')
    .select('slug, title, description, payload, updated_at, is_custom')
    .eq('organization_id', organizationId);

  if (error) {
    throw error;
  }

  const overrideBySlug = new Map<string, PresetRow>();
  const customPresets: AdminTemplatePresetView[] = [];

  for (const row of data ?? []) {
    const presetRow = row as PresetRow;
    if (presetRow.is_custom) {
      const custom = customRowToPreset(presetRow);
      if (custom) customPresets.push(custom);
    } else {
      overrideBySlug.set(presetRow.slug, presetRow);
    }
  }

  const builtins = listAdminTemplatePresets().map((base) =>
    mergeBuiltinPreset(base, overrideBySlug.get(base.slug) ?? null),
  );

  customPresets.sort((a, b) => a.title.localeCompare(b.title));
  return [...builtins, ...customPresets];
}

export function payloadToTemplatePayload(
  payload: AdminTemplatePresetPayload,
): TemplatePayload {
  const sample_values: { body?: string[]; header?: string[] } = {};
  if (payload.body_samples.some((v) => v.trim())) {
    sample_values.body = payload.body_samples.map((v) => v.trim());
  }
  if (payload.header_format === 'text' && payload.header_sample.trim()) {
    sample_values.header = [payload.header_sample.trim()];
  }

  return {
    name: payload.name.trim(),
    category: payload.category,
    language: payload.language.trim() || 'en_US',
    header_type:
      payload.header_format === 'none' ? undefined : payload.header_format,
    header_content:
      payload.header_format === 'text'
        ? payload.header_content.trim()
        : undefined,
    header_media_url:
      payload.header_format !== 'none' && payload.header_format !== 'text'
        ? payload.header_media_url.trim() || undefined
        : undefined,
    body_text: payload.body_text.trim(),
    footer_text: payload.footer_text.trim() || undefined,
    buttons: payload.buttons.length > 0 ? payload.buttons : undefined,
    sample_values:
      Object.keys(sample_values).length > 0 ? sample_values : undefined,
  };
}

export function validatePresetPayload(payload: AdminTemplatePresetPayload): void {
  validateTemplateName(payload.name.trim());
  const bodyIndices = validateBody(payload.body_text);
  validateFooter(payload.footer_text || undefined);
  validateButtons(payload.buttons);

  if (payload.header_format === 'text') {
    const headerResult = validateHeader({
      header_type: 'text',
      header_content: payload.header_content,
    });
    validateSampleValues(
      {
        ...payloadToTemplatePayload(payload),
        header_type: 'text',
        header_content: payload.header_content,
      },
      bodyIndices.length,
      headerResult.variableCount,
    );
    return;
  }

  if (payload.header_format !== 'none') {
    if (payload.header_media_url.trim()) {
      validateHeader({
        header_type: payload.header_format,
        header_media_url: payload.header_media_url.trim(),
      });
    }
  }

  validateSampleValues(
    payloadToTemplatePayload(payload),
    bodyIndices.length,
    0,
  );
}

async function getPresetRow(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<PresetRow | null> {
  const { data, error } = await supabase
    .from('admin_template_preset_overrides')
    .select('slug, title, description, payload, updated_at, is_custom')
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .maybeSingle();

  if (error) throw error;
  return (data as PresetRow | null) ?? null;
}

export async function createAdminTemplateCustomPreset(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  input: {
    slug: string;
    title: string;
    description?: string;
    payload: AdminTemplatePresetPayload;
  },
): Promise<void> {
  const slug = input.slug.trim();
  const title = input.title.trim();
  if (!slug) throw new Error('Template slug is required.');
  if (!title) throw new Error('Gallery title is required.');
  if (isBuiltinPresetSlug(slug)) {
    throw new Error('That name is reserved for a built-in template.');
  }
  if (input.payload.name.trim() !== slug) {
    throw new Error('Template name must match the gallery slug.');
  }

  validatePresetPayload(input.payload);

  const existing = await getPresetRow(supabase, organizationId, slug);
  if (existing) {
    throw new Error('A template with this name already exists.');
  }

  const { error } = await supabase.from('admin_template_preset_overrides').insert({
    organization_id: organizationId,
    slug,
    title,
    description: input.description?.trim() || null,
    payload: input.payload,
    is_custom: true,
    updated_by: userId,
  });

  if (error) throw error;
}

export async function saveAdminTemplatePresetOverride(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  slug: string,
  input: {
    title?: string;
    description?: string;
    payload: AdminTemplatePresetPayload;
  },
): Promise<void> {
  const base = getAdminTemplatePreset(slug);
  if (!base) {
    throw new Error('Unknown template preset.');
  }

  validatePresetPayload(input.payload);

  const { error } = await supabase.from('admin_template_preset_overrides').upsert(
    {
      organization_id: organizationId,
      slug,
      title: input.title?.trim() || null,
      description: input.description?.trim() || null,
      payload: input.payload,
      is_custom: false,
      updated_by: userId,
    },
    { onConflict: 'organization_id,slug' },
  );

  if (error) throw error;
}

export async function updateAdminTemplateCustomPreset(
  supabase: SupabaseClient,
  organizationId: string,
  userId: string,
  slug: string,
  input: {
    title: string;
    description?: string;
    payload: AdminTemplatePresetPayload;
  },
): Promise<void> {
  const title = input.title.trim();
  if (!title) throw new Error('Gallery title is required.');
  if (input.payload.name.trim() !== slug) {
    throw new Error('Template name must stay the same as the saved template.');
  }

  validatePresetPayload(input.payload);

  const existing = await getPresetRow(supabase, organizationId, slug);
  if (!existing?.is_custom) {
    throw new Error('Custom template not found.');
  }

  const { error } = await supabase
    .from('admin_template_preset_overrides')
    .update({
      title,
      description: input.description?.trim() || null,
      payload: input.payload,
      updated_by: userId,
    })
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .eq('is_custom', true);

  if (error) throw error;
}

export async function deleteAdminTemplatePresetOverride(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<'builtin_reset' | 'custom_deleted'> {
  const existing = await getPresetRow(supabase, organizationId, slug);

  if (existing?.is_custom) {
    const { error } = await supabase
      .from('admin_template_preset_overrides')
      .delete()
      .eq('organization_id', organizationId)
      .eq('slug', slug)
      .eq('is_custom', true);
    if (error) throw error;
    return 'custom_deleted';
  }

  if (!isBuiltinPresetSlug(slug)) {
    throw new Error('Template not found.');
  }

  const { error } = await supabase
    .from('admin_template_preset_overrides')
    .delete()
    .eq('organization_id', organizationId)
    .eq('slug', slug)
    .eq('is_custom', false);

  if (error) throw error;
  return 'builtin_reset';
}

export function presetViewToFormData(
  preset: AdminTemplatePresetView,
): AdminTemplatePresetPayload {
  return {
    name: preset.name,
    category: preset.category,
    language: preset.language,
    header_format: preset.header_format,
    header_content: preset.header_content,
    header_media_url: preset.header_media_url,
    header_sample: preset.header_sample,
    body_text: preset.body_text,
    body_samples: [...preset.body_samples],
    footer_text: preset.footer_text,
    buttons: [...preset.buttons],
  };
}

export function formsEqual(
  a: AdminTemplatePresetPayload,
  b: AdminTemplatePresetPayload,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface PresetEditorSnapshot {
  form: AdminTemplatePresetPayload;
  title: string;
  description: string;
}

export function presetToEditorSnapshot(
  preset: AdminTemplatePresetView,
): PresetEditorSnapshot {
  return {
    form: presetViewToFormData(preset),
    title: preset.title,
    description: preset.description,
  };
}

export function editorSnapshotsEqual(
  a: PresetEditorSnapshot,
  b: PresetEditorSnapshot,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
