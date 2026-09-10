/**
 * Predefined WhatsApp message templates for super-admin push.
 *
 * Static gallery — same pattern as flow/automation templates: small set,
 * versioned with code, no DB. Ops pick a preset, optionally tweak the
 * form, select brands, and push to Meta in one click.
 */

import type { MessageTemplate, TemplateButton } from '@/types';

export type AdminTemplatePresetIcon =
  | 'shopping'
  | 'package'
  | 'truck'
  | 'cart'
  | 'phone';

export interface AdminTemplatePreset {
  slug: string;
  /** Display title in the gallery. */
  title: string;
  description: string;
  icon: AdminTemplatePresetIcon;
  /** Hint shown when a media header needs a URL before push. */
  media_note?: string;
  /** Meta template name (snake_case). */
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

const ORDER_CONFIRMATION: AdminTemplatePreset = {
  slug: 'order_confirmation',
  title: 'Order confirmation',
  description:
    'Notify customers when a new order is placed. Pairs with Shopify order confirmation campaigns.',
  icon: 'shopping',
  name: 'order_confirmation',
  category: 'Utility',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text:
    'Hi {{1}}, thank you for your order! Your order {{2}} for {{3}} has been confirmed. We will notify you when it ships.',
  body_samples: ['Mohan', '#1001', 'Rs 1,299'],
  footer_text: '',
  buttons: [],
};

const ORDER_PLACED_COD: AdminTemplatePreset = {
  slug: 'order_placed_cod',
  title: 'COD order placed',
  description:
    'Confirm cash-on-delivery orders with a product image header. Add a public image URL before pushing.',
  icon: 'package',
  media_note: 'Paste a public HTTPS product image URL in the Header field before pushing.',
  name: 'order_placed_cod',
  category: 'Utility',
  language: 'en_US',
  header_format: 'image',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text:
    'Hi {{1}}, your COD order {{2}} worth {{3}} has been placed. Please confirm your delivery details to proceed.',
  body_samples: ['Mohan', '#TTF10134', 'Rs 648'],
  footer_text: '',
  buttons: [{ type: 'QUICK_REPLY', text: 'Confirm order' }],
};

const FULFILLMENT_UPDATE: AdminTemplatePreset = {
  slug: 'fulfillment_update',
  title: 'Fulfillment update',
  description:
    'Tell customers their order shipped with tracking info. Pairs with Shopify fulfillment campaigns.',
  icon: 'truck',
  name: 'fulfillment_update',
  category: 'Utility',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text:
    'Hi {{1}}, great news! Your order {{2}} has been shipped. Tracking number: {{3}}.',
  body_samples: ['Mohan', '#1001', 'AWB123456789'],
  footer_text: '',
  buttons: [],
};

const ABANDONED_CHECKOUT: AdminTemplatePreset = {
  slug: 'abandoned_checkout',
  title: 'Abandoned checkout',
  description:
    'Recover carts left behind. Pairs with Shopify abandoned checkout campaigns.',
  icon: 'cart',
  name: 'abandoned_checkout',
  category: 'Marketing',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text:
    'Hi {{1}}, you left {{2}} in your cart. Complete your purchase before it sells out!',
  body_samples: ['Mohan', '2 items'],
  footer_text: '',
  buttons: [{ type: 'URL', text: 'Complete order', url: 'https://example.com/{{1}}', example: 'abc123' }],
};

const COD_CALL_NOT_CONNECTED: AdminTemplatePreset = {
  slug: 'cod_call_not_connected_v1',
  title: 'COD call not connected',
  description:
    'Follow up when a COD confirmation call fails. Used in recovery flows after missed calls.',
  icon: 'phone',
  name: 'cod_call_not_connected_v1',
  category: 'Utility',
  language: 'en_US',
  header_format: 'none',
  header_content: '',
  header_media_url: '',
  header_sample: '',
  body_text:
    'Hi {{1}}, your order {{2}} for {{3}} needs confirmation. We tried calling but could not reach you. Please reply to confirm.',
  body_samples: ['Mohan', '#1001', 'Rs 1,299'],
  footer_text: '',
  buttons: [
    { type: 'QUICK_REPLY', text: 'Confirm order' },
    { type: 'QUICK_REPLY', text: 'Call me back' },
  ],
};

const COD_NOT_PICKED_UP: AdminTemplatePreset = {
  slug: 'cod_not_picked_up',
  title: 'COD not picked up',
  description:
    'Short follow-up when the customer did not answer a COD verification call.',
  icon: 'phone',
  name: 'cod_not_picked_up',
  category: 'Utility',
  language: 'en_US',
  header_format: 'text',
  header_content: 'Order update',
  header_media_url: '',
  header_sample: '',
  body_text:
    "Hi {{1}}, we tried calling about your COD order {{2}} but couldn't reach you. Please confirm or request a callback.",
  body_samples: ['Mohan', '#1001'],
  footer_text: '',
  buttons: [{ type: 'QUICK_REPLY', text: 'Call me back' }],
};

const PRESETS: Record<string, AdminTemplatePreset> = {
  order_confirmation: ORDER_CONFIRMATION,
  order_placed_cod: ORDER_PLACED_COD,
  fulfillment_update: FULFILLMENT_UPDATE,
  abandoned_checkout: ABANDONED_CHECKOUT,
  cod_call_not_connected_v1: COD_CALL_NOT_CONNECTED,
  cod_not_picked_up: COD_NOT_PICKED_UP,
};

export function listAdminTemplatePresets(): AdminTemplatePreset[] {
  return Object.values(PRESETS);
}

export function getAdminTemplatePreset(
  slug: string,
): AdminTemplatePreset | null {
  return PRESETS[slug] ?? null;
}

/** Map a preset into the admin push form shape (includes template `name`). */
export function presetToFormData(
  preset: AdminTemplatePreset,
): Omit<
  AdminTemplatePreset,
  'slug' | 'title' | 'description' | 'icon' | 'media_note'
> {
  const {
    slug: _slug,
    title: _title,
    description: _desc,
    icon: _icon,
    media_note: _note,
    ...form
  } = preset;
  return form;
}
