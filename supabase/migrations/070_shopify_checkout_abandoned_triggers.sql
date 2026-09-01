-- ============================================================
-- 070_shopify_checkout_abandoned_triggers.sql — Shopify checkout
-- abandonment flow triggers (native Shopify + checkout-app webhook).
-- Idempotent — safe to re-run.
-- ============================================================

ALTER TABLE flows
  DROP CONSTRAINT IF EXISTS flows_trigger_type_check;

ALTER TABLE flows
  ADD CONSTRAINT flows_trigger_type_check
  CHECK (trigger_type IN (
    'keyword',
    'first_inbound_message',
    'manual',
    'new_message_received',
    'webhook_received',
    'shopify_order_placed',
    'shopify_order_updated',
    'shopify_order_fulfilled',
    'shopify_order_cancelled',
    'shopify_order_partially_fulfilled',
    'shopify_checkout_abandoned',
    'shopify_checkout_app_abandoned',
    'woocommerce_order_placed',
    'woocommerce_order_updated',
    'woocommerce_order_completed',
    'woocommerce_order_cancelled',
    'tag_added',
    'conversation_assigned',
    'time_based',
    'google_sheet_row'
  ));
