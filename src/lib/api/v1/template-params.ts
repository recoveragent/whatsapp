import type { MessageTemplate, TemplateButton } from '@/types';
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';

/** Recover Agent field names we accept in object-style `params`. */
export const RECOVER_AGENT_PARAM_FIELDS = [
  'customer_name',
  'order_name',
  'checkout_id',
  'product',
  'amount',
  'recording_url',
  'awb_no',
  'reason',
] as const;

export interface PublicTemplateSummary {
  /** Meta template name — use as `template_id` on send. */
  id: string;
  /** Human label for dropdowns. */
  name: string;
  /** Ordered variable slot names for object-style params. */
  params: string[];
  /** Same as `params.length` — provided for callers that only need a count. */
  param_count: number;
  language: string;
  category: MessageTemplate['category'];
  /** Template body with Meta {{N}} placeholders. */
  body: string;
  /** Text header content, when `header_type` is `text`. */
  header?: string;
  /** Meta header format: text, image, video, or document. */
  header_type?: MessageTemplate['header_type'];
  /** Sample media URL for image/video/document headers (preview only). */
  header_media_url?: string;
  footer?: string;
  buttons?: TemplateButton[];
}

function publicHeader(template: MessageTemplate): string | undefined {
  if (template.header_type !== 'text') return undefined;
  const content = template.header_content?.trim();
  return content || undefined;
}

function publicHeaderMediaUrl(template: MessageTemplate): string | undefined {
  if (
    !template.header_type ||
    !['image', 'video', 'document'].includes(template.header_type)
  ) {
    return undefined;
  }
  const url = template.header_media_url?.trim();
  return url || undefined;
}

export function humanizeTemplateName(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Derive the variable slots a caller must fill for a template send.
 * Body slots are `body_1`, `body_2`, …; media headers use `header_media`.
 */
export function deriveTemplateParamSlots(template: MessageTemplate): string[] {
  const slots: string[] = [];

  if (extractVariableIndices(template.header_content ?? '').length > 0) {
    slots.push('header_text');
  }

  if (
    template.header_type &&
    ['image', 'video', 'document'].includes(template.header_type)
  ) {
    slots.push('header_media');
  }

  const bodyCount = extractVariableIndices(template.body_text).length;
  for (let i = 1; i <= bodyCount; i += 1) {
    slots.push(`body_${i}`);
  }

  template.buttons?.forEach((button, index) => {
    if (button.type === 'URL' && extractVariableIndices(button.url).length > 0) {
      slots.push(`button_${index + 1}_url`);
    }
  });

  return slots;
}

export function toPublicTemplateSummary(
  template: MessageTemplate,
): PublicTemplateSummary {
  const params = deriveTemplateParamSlots(template);
  const header = publicHeader(template);
  const headerMediaUrl = publicHeaderMediaUrl(template);
  const footer = template.footer_text?.trim() || undefined;
  const buttons =
    template.buttons && template.buttons.length > 0 ? template.buttons : undefined;

  return {
    id: template.name,
    name: humanizeTemplateName(template.name),
    params,
    param_count: params.length,
    language: template.language ?? 'en_US',
    category: template.category,
    body: template.body_text,
    ...(header ? { header } : {}),
    ...(template.header_type ? { header_type: template.header_type } : {}),
    ...(headerMediaUrl ? { header_media_url: headerMediaUrl } : {}),
    ...(footer ? { footer } : {}),
    ...(buttons ? { buttons } : {}),
  };
}

function readObjectParam(
  params: Record<string, string>,
  key: string,
): string | undefined {
  const value = params[key];
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve caller `params` (array or object) into Meta send-time values.
 * Arrays are treated as body variables in order. Objects are mapped by
 * slot names from `deriveTemplateParamSlots`, with Recover Agent semantic
 * aliases as a fallback for body slots.
 */
export function resolveSendTimeParams(
  template: MessageTemplate,
  params: string[] | Record<string, string>,
): SendTimeParams {
  if (Array.isArray(params)) {
    return { body: params.map((value) => String(value)) };
  }

  const slots = deriveTemplateParamSlots(template);
  const body: string[] = [];
  let headerText: string | undefined;
  let headerMediaUrl: string | undefined;
  const buttonParams: Record<number, string> = {};

  for (const slot of slots) {
    const value = readObjectParam(params, slot);
    if (slot === 'header_text') {
      headerText = value;
    } else if (slot === 'header_media') {
      headerMediaUrl = value;
    } else if (slot.startsWith('body_')) {
      if (value !== undefined) body.push(value);
    } else if (slot.startsWith('button_') && slot.endsWith('_url')) {
      const index = Number(slot.match(/^button_(\d+)_url$/)?.[1]) - 1;
      if (Number.isFinite(index) && index >= 0 && value) {
        buttonParams[index] = value;
      }
    }
  }

  const bodyCount = extractVariableIndices(template.body_text).length;
  if (body.length < bodyCount) {
    body.length = 0;
    for (const field of RECOVER_AGENT_PARAM_FIELDS) {
      const value = readObjectParam(params, field);
      if (value === undefined) continue;
      if (field === 'recording_url') continue;
      body.push(value);
      if (body.length >= bodyCount) break;
    }
  }

  if (!headerMediaUrl) {
    headerMediaUrl =
      readObjectParam(params, 'recording_url') ??
      readObjectParam(params, 'product_image');
  }

  const headerVarCount = extractVariableIndices(template.header_content ?? '').length;
  if (!headerText && headerVarCount > 0) {
    headerText =
      readObjectParam(params, 'customer_name') ??
      readObjectParam(params, 'order_name');
  }

  return {
    body,
    headerText,
    headerMediaUrl,
    headerMediaRequired: slots.includes('header_media'),
    buttonParams: Object.keys(buttonParams).length > 0 ? buttonParams : undefined,
  };
}
