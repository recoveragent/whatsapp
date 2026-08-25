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
}

export interface WooCommerceOrderPayload {
  id: number;
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
