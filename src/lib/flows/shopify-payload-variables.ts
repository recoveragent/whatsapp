import {
  extractByPath,
  flattenPayloadKeys,
} from '@/lib/automations/webhook-payload';

/** Separate raw fields from the friendly Shopify variables to avoid name collisions. */
export function shopifyPayloadVariables(
  payload: unknown,
  namespace = 'shopify_order'
): Record<string, unknown> {
  return Object.fromEntries(
    flattenPayloadKeys(payload).map((path) => {
      const value = extractByPath(payload, path);
      return [
        `${namespace}.${path}`,
        value == null
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : value,
      ];
    })
  );
}
