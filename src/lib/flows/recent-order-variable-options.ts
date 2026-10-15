import {
  extractByPath,
  flattenPayloadKeys,
} from '@/lib/automations/webhook-payload';

/** Only offer values that can be inserted into text or media URL fields. */
export function recentOrderVariableOptions(order: Record<string, unknown>) {
  return flattenPayloadKeys(order).flatMap((path) => {
    const value = extractByPath(order, path);
    if (value !== null && typeof value === 'object') return [];

    const property = /(?:^|\.)properties\.\d+\.value$/.test(path)
      ? extractByPath(order, path.slice(0, -'.value'.length))
      : undefined;
    const propertyName =
      property && typeof property === 'object' && 'name' in property
        ? String(property.name ?? '')
        : '';

    return [
      {
        path,
        label: propertyName ? `${propertyName} (${path})` : path,
        value: String(value ?? 'null'),
        token: `{{ vars.shopify_order.${path} }}`,
      },
    ];
  });
}
