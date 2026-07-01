import type { ShopifyCampaignType, ShopifyVariableKey } from './types';

export interface CampaignDefinition {
  campaign_type: ShopifyCampaignType;
  name: string;
  description: string;
  default_delay_minutes?: number;
  suggested_variables: Record<string, ShopifyVariableKey>;
}

export const SHOPIFY_CAMPAIGN_DEFINITIONS: CampaignDefinition[] = [
  {
    campaign_type: 'order_confirmation',
    name: 'Order confirmation',
    description:
      'Send a WhatsApp message when a new order is placed in your Shopify store.',
    suggested_variables: {
      '1': 'customer_name',
      '2': 'order_number',
      '3': 'order_total',
    },
  },
  {
    campaign_type: 'fulfillment_update',
    name: 'Fulfillment update',
    description:
      'Notify customers when their order is fulfilled or tracking is added.',
    suggested_variables: {
      '1': 'customer_name',
      '2': 'order_number',
      '3': 'tracking_number',
      '4': 'tracking_url',
    },
  },
  {
    campaign_type: 'abandoned_checkout',
    name: 'Abandoned checkout',
    description:
      'Recover lost sales by messaging customers who left items in their cart.',
    default_delay_minutes: 60,
    suggested_variables: {
      '1': 'customer_name',
      '2': 'order_items',
      '3': 'checkout_url',
    },
  },
];

export function getCampaignDefinition(type: ShopifyCampaignType): CampaignDefinition {
  return (
    SHOPIFY_CAMPAIGN_DEFINITIONS.find((d) => d.campaign_type === type) ??
    SHOPIFY_CAMPAIGN_DEFINITIONS[0]!
  );
}
