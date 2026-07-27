export type ShopifyCampaignType =
  | 'order_confirmation'
  | 'fulfillment_update'
  | 'abandoned_checkout';

export type ShopifyVariableKey =
  | 'customer_name'
  | 'order_number'
  | 'order_total'
  | 'order_items'
  | 'shipping_address'
  | 'tracking_number'
  | 'tracking_url'
  | 'checkout_url'
  | 'fulfillment_status'
  | 'shop_name';

/** Subset of Shopify address fields we read from order/checkout payloads. */
export interface ShopifyAddressFields {
  first_name?: string;
  last_name?: string;
  name?: string;
  company?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province?: string;
  province_code?: string;
  zip?: string;
  country?: string;
  country_code?: string;
  phone?: string;
}

export interface ShopifyCampaignRow {
  id: string;
  account_id: string;
  campaign_type: ShopifyCampaignType;
  is_enabled: boolean;
  template_name: string | null;
  template_language: string;
  variable_mapping: Record<string, ShopifyVariableKey>;
  delay_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface ShopifyConfigRow {
  id: string;
  account_id: string;
  user_id: string;
  shop_domain: string;
  access_token: string;
  /** Shopify custom app Client ID (plaintext). */
  api_key?: string | null;
  /** Encrypted custom app Client Secret. */
  api_secret?: string | null;
  scopes: string[];
  status: 'connected' | 'disconnected';
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Runtime context extracted from a Shopify webhook payload. */
export interface ShopifyEventContext {
  customerName: string;
  phone: string | null;
  email: string | null;
  orderNumber: string | null;
  orderTotal: string | null;
  orderItems: string | null;
  /** Formatted shipping / delivery address for templates. */
  shippingAddress: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  checkoutUrl: string | null;
  fulfillmentStatus: string | null;
  /** Shopify `financial_status` on orders (paid, pending, partially_paid, …). */
  financialStatus: string | null;
  shopName: string;
  resourceKey: string;
}

export interface ShopifyOrderPayload {
  id?: number | string;
  name?: string;
  order_number?: number;
  total_price?: string;
  currency?: string;
  financial_status?: string;
  fulfillment_status?: string | null;
  cancelled_at?: string | null;
  payment_gateway_names?: string[];
  tags?: string;
  created_at?: string;
  line_items?: Array<{ name?: string; title?: string; quantity?: number }>;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
    default_address?: { phone?: string };
  };
  shipping_address?: ShopifyAddressFields;
  billing_address?: ShopifyAddressFields;
  phone?: string;
  contact_phone?: string;
  email?: string;
  fulfillments?: Array<{
    status?: string;
    tracking_number?: string | null;
    tracking_url?: string | null;
    tracking_company?: string | null;
  }>;
}

export interface ShopifyCheckoutPayload {
  id?: number | string;
  token?: string;
  abandoned_checkout_url?: string;
  total_price?: string;
  currency?: string;
  completed_at?: string | null;
  line_items?: Array<{ title?: string; quantity?: number }>;
  customer?: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    email?: string;
  };
  shipping_address?: ShopifyAddressFields;
  billing_address?: ShopifyAddressFields;
  phone?: string;
  email?: string;
}

export interface ShopifyFulfillmentPayload {
  id?: number | string;
  order_id?: number | string;
  status?: string;
  tracking_number?: string;
  tracking_url?: string;
  tracking_company?: string;
}
