import {
  extractByPath,
  flattenPayloadKeys,
} from '@/lib/automations/webhook-payload';

/** Shopify line-item `properties` use name/value; WooCommerce `meta_data` uses key/value. */
const NAMED_LIST_RE = /^(.*?)(properties|meta_data)\.(\d+)\.value$/;

/** "Parents photo - original" → "parents_photo_original" (token-safe: `[\w.]`). */
export function propertyNameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface NamedPropertyPath {
  /** Positional path, e.g. `line_items.0.properties.19.value`. */
  path: string;
  /** Name-based alias, e.g. `line_items.0.properties.parents_photo`. */
  alias: string;
  /** Original property name, e.g. `Parents photo`. */
  name: string;
}

/**
 * Map positional property values to name-based aliases so a flow keeps working
 * when a storefront app reorders or adds properties. The first property with a
 * given name wins; names that slug to nothing or only digits stay positional.
 */
export function namedPropertyPaths(payload: unknown): NamedPropertyPath[] {
  const seen = new Set<string>();
  const result: NamedPropertyPath[] = [];
  for (const path of flattenPayloadKeys(payload)) {
    const m = path.match(NAMED_LIST_RE);
    if (!m) continue;
    const [, prefix, list, index] = m;
    const entry = extractByPath(payload, `${prefix}${list}.${index}`);
    if (!entry || typeof entry !== 'object') continue;
    const rawName = (entry as Record<string, unknown>)[
      list === 'meta_data' ? 'key' : 'name'
    ];
    if (typeof rawName !== 'string') continue;
    const slug = propertyNameSlug(rawName);
    if (!slug || /^\d+$/.test(slug)) continue;
    const alias = `${prefix}${list}.${slug}`;
    if (seen.has(alias)) continue;
    seen.add(alias);
    result.push({ path, alias, name: rawName });
  }
  return result;
}

function toVarValue(value: unknown): unknown {
  return value == null
    ? ''
    : typeof value === 'object'
      ? JSON.stringify(value)
      : value;
}

/** Separate raw fields from the friendly Shopify variables to avoid name collisions. */
export function shopifyPayloadVariables(
  payload: unknown,
  namespace = 'shopify_order'
): Record<string, unknown> {
  const vars: Record<string, unknown> = Object.fromEntries(
    flattenPayloadKeys(payload).map((path) => [
      `${namespace}.${path}`,
      toVarValue(extractByPath(payload, path)),
    ])
  );
  for (const { path, alias } of namedPropertyPaths(payload)) {
    const key = `${namespace}.${alias}`;
    if (!(key in vars)) vars[key] = toVarValue(extractByPath(payload, path));
  }
  return vars;
}
