export interface WooCommerceConfigRow {
  account_id: string;
  user_id: string;
  store_url: string;
  consumer_key: string;
  consumer_secret: string;
  webhook_secret: string | null;
  status: 'connected' | 'disconnected';
}

export interface WooCommerceBillingAddress {
  phone?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  city?: string;
  state?: string;
  country?: string;
  postcode?: string;
}

export interface WooCommerceCustomerPayload {
  id: number;
  date_created?: string;
  date_created_gmt?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  username?: string;
  billing?: WooCommerceBillingAddress;
  shipping?: WooCommerceBillingAddress;
  is_paying_customer?: boolean;
  /** WooCommerce aggregate — refreshed on sync. */
  orders_count?: number;
  /** WooCommerce aggregate string, e.g. "1234.56". */
  total_spent?: string;
}

export interface WooCommerceCustomerStatsRow {
  account_id: string;
  contact_id: string;
  woocommerce_customer_id: string;
  order_count: number;
  total_spend: number;
  currency: string | null;
  last_order_at: string | null;
  first_order_at: string | null;
  latest_payment_status: string | null;
  preferred_payment_gateway: string | null;
  billing_country: string | null;
  billing_state: string | null;
  billing_city: string | null;
  is_paying_customer: boolean;
  customer_since: string | null;
  synced_at: string;
  updated_at: string;
}

export interface WooCommerceOrderPayload {
  id: number;
  customer_id?: number;
  number?: string;
  status?: string;
  total?: string;
  currency?: string;
  date_created?: string;
  date_created_gmt?: string;
  payment_method?: string;
  payment_method_title?: string;
  billing?: WooCommerceBillingAddress;
  shipping?: WooCommerceBillingAddress;
  order_key?: string;
  line_items?: WooCommerceLineItem[];
}

export interface WooCommerceLineItem {
  name?: string;
  quantity?: number;
  product_id?: number;
  sku?: string;
}

export interface WooCommerceEventContext {
  resourceKey: string;
  phone: string | null;
  customerName: string | null;
  email: string | null;
  orderNumber: string | null;
  orderTotal: string | null;
  orderItems: string | null;
  paymentStatus: string | null;
  fulfillmentStatus: string | null;
  orderStatusUrl: string | null;
  storeName: string | null;
}

export interface WooCommerceWebhookRow {
  id: number;
  name: string;
  topic: string;
  delivery_url: string;
  secret?: string;
  status?: string;
}
