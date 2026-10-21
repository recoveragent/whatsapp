import type { WooCommerceOrderPayload } from './types';

/**
 * How a WooCommerce order was paid, derived from the gateway id plus
 * payment evidence. Order status alone can't tell COD and prepaid apart —
 * both land on `processing`.
 */
export type WooCommercePaymentType =
  | 'cod'
  | 'prepaid'
  /** Online gateway, but no sign the payment went through yet. */
  | 'unpaid_online'
  /** Bank transfer / cheque — neither COD nor online. */
  | 'offline'
  /** No gateway on the order (e.g. created manually in wp-admin). */
  | 'unknown';

export const WOOCOMMERCE_COD_GATEWAY_ID = 'cod';

/** Core offline gateways that are paid outside the checkout. */
export const WOOCOMMERCE_OFFLINE_GATEWAY_IDS: readonly string[] = ['bacs', 'cheque'];

export function normalizeWooCommerceGatewayId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase();
  return value || null;
}

function hasValue(raw: unknown): boolean {
  return typeof raw === 'string' && raw.trim().length > 0;
}

/**
 * Classify an order's payment. Prepaid needs evidence beyond the gateway id:
 * WooCommerce also stamps `date_paid` on COD orders moving to processing,
 * so `date_paid` only counts once COD and offline gateways are ruled out.
 */
export function classifyWooCommercePayment(
  order: Pick<
    WooCommerceOrderPayload,
    'payment_method' | 'date_paid' | 'date_paid_gmt' | 'transaction_id'
  >,
): WooCommercePaymentType {
  const gateway = normalizeWooCommerceGatewayId(order.payment_method);
  if (!gateway) return 'unknown';
  if (gateway === WOOCOMMERCE_COD_GATEWAY_ID) return 'cod';
  if (WOOCOMMERCE_OFFLINE_GATEWAY_IDS.includes(gateway)) return 'offline';
  const paid =
    hasValue(order.date_paid) ||
    hasValue(order.date_paid_gmt) ||
    hasValue(order.transaction_id);
  return paid ? 'prepaid' : 'unpaid_online';
}
