type Row = Record<string, unknown>;
const row = (v: unknown): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};

/**
 * The part of a saved checkout that becomes `vars.shopify_order.*` at run time.
 * Recover Agent mirrors flatten `event.raw ?? event`; native Shopify checkouts
 * flatten the checkout itself.
 */
export function checkoutVariablePayload(payload: unknown): Row {
  const saved = row(payload);
  if (saved._wa_recover_agent_mirror !== true) return saved;
  const event = row(saved.event);
  return event.raw && typeof event.raw === 'object' ? row(event.raw) : event;
}
