import type { SupabaseClient } from '@supabase/supabase-js';

import type { MessageTemplate, TemplateButton } from '@/types';

import {
  getAdminTemplatePreset,
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
}

interface OverrideRow {
  slug: string;
  title: string | null;
  description: string | null;
  payload: AdminTemplatePresetPayload;
  updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePayload(raw: unknown): AdminTemplatePresetPayload | null {
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

function mergePreset(
  base: AdminTemplatePreset,
  override: OverrideRow | null,
): AdminTemplatePresetView {
  if (!override) {
    return { ...base, has_override: false };
  }
  const payload = parsePayload(override.payload);
  if (!payload) {
    return { ...base, has_override: false };
  }
  return {
    ...base,
    ...payload,
    title: override.title?.trim() || base.title,
    description: override.description?.trim() || base.description,
    buttons: [...payload.buttons],
    body_samples: [...payload.body_samples],
    has_override: true,
  };
}

export async function listMergedAdminTemplatePresets(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<AdminTemplatePresetView[]> {
  const { data, error } = await supabase
    .from('admin_template_preset_overrides')
    .select('slug, title, description, payload, updated_at')
    .eq('organization_id', organizationId);

  if (error) {
    throw error;
  }

  const overrideBySlug = new Map(
    (data ?? []).map((row) => [row.slug as string, row as OverrideRow]),
  );

  return listAdminTemplatePresets().map((base) =>
    mergePreset(base, overrideBySlug.get(base.slug) ?? null),
  );
}

export function payloadToTemplatePayload(
  payload: AdminTemplatePresetPayload,
): Parameters<typeof validateTemplatePayload>[0] {
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
      updated_by: userId,
    },
    { onConflict: 'organization_id,slug' },
  );

  if (error) throw error;
}

export async function deleteAdminTemplatePresetOverride(
  supabase: SupabaseClient,
  organizationId: string,
  slug: string,
): Promise<void> {
  const base = getAdminTemplatePreset(slug);
  if (!base) {
    throw new Error('Unknown template preset.');
  }

  const { error } = await supabase
    .from('admin_template_preset_overrides')
    .delete()
    .eq('organization_id', organizationId)
    .eq('slug', slug);

  if (error) throw error;
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
