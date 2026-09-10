/**
 * Built-in global flow presets for super-admin multi-brand deploy.
 * Same static-gallery pattern as admin-template-presets.ts.
 */

import type { FlowSnapshot } from './clone-flow-snapshot';

export const BUILTIN_FLOW_PRESET_SLUGS = ['product_recommendation'] as const;

export type BuiltinFlowPresetSlug = (typeof BUILTIN_FLOW_PRESET_SLUGS)[number];

export function isBuiltinFlowPresetSlug(slug: string): slug is BuiltinFlowPresetSlug {
  return (BUILTIN_FLOW_PRESET_SLUGS as readonly string[]).includes(slug);
}

export interface AdminBuiltinFlowPresetView {
  slug: string;
  title: string;
  description: string;
  source_flow_id: null;
  source_brand_id: null;
  source_brand_name: string;
  node_count: number;
  trigger_type: string;
  flow_name: string;
  updated_at: string;
  builtin: true;
}

const PRODUCT_RECOMMENDATION_SNAPSHOT: FlowSnapshot = {
  name: 'Product recommendation',
  description:
    'Send a Shopify product card with checkout link when customers ask about products.',
  trigger_type: 'keyword',
  trigger_config: {
    keywords: ['catalog', 'product', 'buy', 'shop'],
    match_type: 'contains',
  },
  entry_node_id: 'start',
  fallback_policy: null,
  exit_config: null,
  nodes: [
    {
      node_key: 'start',
      node_type: 'start',
      config: { next_node_key: 'greet' },
      position_x: 0,
      position_y: 0,
    },
    {
      node_key: 'greet',
      node_type: 'send_message',
      config: {
        text: "Here's a product you might like 👇",
        next_node_key: 'send_product',
      },
      position_x: 0,
      position_y: 120,
    },
    {
      node_key: 'send_product',
      node_type: 'send_product',
      config: {
        product_source: 'fixed',
        shopify_variant_id: '',
        product_title: '',
        quantity: 1,
        next_node_key: 'follow_up',
      },
      position_x: 0,
      position_y: 240,
    },
    {
      node_key: 'follow_up',
      node_type: 'send_buttons',
      config: {
        text: 'Need anything else?',
        buttons: [
          {
            reply_id: 'talk_to_agent',
            title: 'Talk to agent',
            next_node_key: 'handoff',
          },
          {
            reply_id: 'thanks',
            title: 'All good',
            next_node_key: 'end',
          },
        ],
      },
      position_x: 0,
      position_y: 360,
    },
    {
      node_key: 'handoff',
      node_type: 'handoff',
      config: {
        note: 'Customer asked about a product after receiving a recommendation.',
      },
      position_x: -120,
      position_y: 480,
    },
    {
      node_key: 'end',
      node_type: 'end',
      config: {},
      position_x: 120,
      position_y: 480,
    },
  ],
};

const BUILTIN_FLOW_PRESETS: Record<
  BuiltinFlowPresetSlug,
  { view: AdminBuiltinFlowPresetView; snapshot: FlowSnapshot }
> = {
  product_recommendation: {
    view: {
      slug: 'product_recommendation',
      title: 'Product recommendation (Sell on WhatsApp)',
      description:
        'Keyword-triggered flow that sends a Shopify product card with checkout link, then offers agent handoff.',
      source_flow_id: null,
      source_brand_id: null,
      source_brand_name: 'Built-in',
      node_count: PRODUCT_RECOMMENDATION_SNAPSHOT.nodes.length,
      trigger_type: 'keyword',
      flow_name: PRODUCT_RECOMMENDATION_SNAPSHOT.name,
      updated_at: '1970-01-01T00:00:00.000Z',
      builtin: true,
    },
    snapshot: PRODUCT_RECOMMENDATION_SNAPSHOT,
  },
};

export function listBuiltinAdminFlowPresets(): AdminBuiltinFlowPresetView[] {
  return BUILTIN_FLOW_PRESET_SLUGS.map((slug) => BUILTIN_FLOW_PRESETS[slug].view);
}

export function getBuiltinAdminFlowPresetSnapshot(
  slug: string,
): FlowSnapshot | null {
  if (!isBuiltinFlowPresetSlug(slug)) return null;
  return BUILTIN_FLOW_PRESETS[slug].snapshot;
}
