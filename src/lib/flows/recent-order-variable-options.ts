import {
  extractByPath,
  flattenPayloadKeys,
} from '@/lib/automations/webhook-payload';
import { namedPropertyPaths } from './shopify-payload-variables';

/** Only offer values that can be inserted into text or media URL fields. */
export function recentOrderVariableOptions(
  order: Record<string, unknown>,
  namespace = 'shopify_order'
) {
  const named = new Map(
    namedPropertyPaths(order).map((entry) => [entry.path, entry])
  );

  return flattenPayloadKeys(order).flatMap((path) => {
    const value = extractByPath(order, path);
    if (value !== null && typeof value === 'object') return [];
    // The name already labels its value row; a positional name row is noise.
    if (/\.(name|key)$/.test(path) && named.has(path.replace(/\w+$/, 'value')))
      return [];

    // Property values insert by name (…properties.parents_photo) so the
    // token survives the storefront reordering or adding properties.
    const property = named.get(path);
    const tokenPath = property?.alias ?? path;

    return [
      {
        path,
        label: property ? `${property.name} (${tokenPath})` : path,
        value: String(value ?? 'null'),
        token: `{{ vars.${namespace}.${tokenPath} }}`,
      },
    ];
  });
}
