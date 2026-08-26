-- ============================================================
-- 064_woocommerce_flow_triggers.sql — Allow WooCommerce order
-- triggers on flows (parity with app + migration 061).
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
    'woocommerce_order_placed',
    'woocommerce_order_updated',
    'woocommerce_order_completed',
    'woocommerce_order_cancelled',
    'tag_added',
    'conversation_assigned',
    'time_based',
    'google_sheet_row'
  ));
