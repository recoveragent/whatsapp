import {
  extractByPath,
  flattenPayloadKeys,
} from '@/lib/automations/webhook-payload';

/** Separate raw fields from the friendly Shopify variables to avoid name collisions. */
export function shopifyPayloadVariables(
  payload: unknown
): Record<string, unknown> {
  return Object.fromEntries(
    flattenPayloadKeys(payload).map((path) => {
      const value = extractByPath(payload, path);
      return [
        `shopify_order.${path}`,
        value == null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : value,
      ];
    })
  );
}
