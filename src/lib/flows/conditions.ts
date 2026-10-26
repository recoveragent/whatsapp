import type { ConditionOperator, ConditionPredicate } from './types';

export type ConditionFieldType =
  'text' | 'number' | 'boolean' | 'list' | 'date' | 'enum';
export interface ConditionField {
  key: string;
  label: string;
  type: ConditionFieldType;
  options?: readonly string[];
  orderOnly?: boolean;
  /** Narrower operator set than the field type allows. */
  operators?: readonly ConditionOperator[];
}

export const CONDITION_ITEM_KEYS = [
  'product_id',
  'variant_id',
  'sku',
  'title',
  'collection_id',
] as const;
export const CONDITION_ITEM_KEY_LABELS: Record<
  (typeof CONDITION_ITEM_KEYS)[number],
  string
> = {
  product_id: 'Product',
  variant_id: 'Variant',
  sku: 'SKU',
  title: 'Product name',
  collection_id: 'Collection',
};
/** Collections are resolved against the configured IDs, so presence checks are meaningless. */
const COLLECTION_OPERATORS = [
  'contains',
  'not_contains',
  'contains_any',
  'contains_all',
] as const;

export const PAYMENT_STATUSES = [
  'paid',
  'pending',
  'partially_paid',
  'authorized',
  'partially_refunded',
  'refunded',
  'voided',
  'expired',
] as const;
export const SHOPIFY_CONDITION_FIELDS: ConditionField[] = [
  {
    key: 'payment_status',
    label: 'Payment status',
    type: 'enum',
    options: PAYMENT_STATUSES,
    orderOnly: true,
  },
  {
    key: 'payment_gateways',
    label: 'Payment gateways',
    type: 'list',
    orderOnly: true,
  },
  {
    key: 'is_cod',
    label: 'Cash on delivery (COD)',
    type: 'boolean',
    orderOnly: true,
  },
  {
    key: 'order_status',
    label: 'Order status',
    type: 'enum',
    options: ['open', 'cancelled', 'closed'],
    orderOnly: true,
  },
  { key: 'total', label: 'Total amount', type: 'number' },
  { key: 'currency', label: 'Currency', type: 'text' },
  {
    key: 'fulfillment_status',
    label: 'Fulfillment status',
    type: 'enum',
    options: ['unfulfilled', 'partial', 'fulfilled', 'restocked'],
    orderOnly: true,
  },
  {
    key: 'shipment_status',
    label: 'Shipment status (any shipment)',
    type: 'list',
    options: [
      'label_printed',
      'label_purchased',
      'confirmed',
      'in_transit',
      'out_for_delivery',
      'attempted_delivery',
      'ready_for_pickup',
      'delivered',
      'failure',
    ],
    orderOnly: true,
  },
  { key: 'product_ids', label: 'Product IDs', type: 'list' },
  { key: 'variant_ids', label: 'Variant IDs', type: 'list' },
  { key: 'skus', label: 'Product SKUs', type: 'list' },
  { key: 'product_names', label: 'Product names', type: 'list' },
  {
    key: 'collection_ids',
    label: 'Product collections',
    type: 'list',
    operators: COLLECTION_OPERATORS,
  },
  { key: 'tags', label: 'Order tags', type: 'list', orderOnly: true },
  { key: 'shipping_address.address1', label: 'Address line 1', type: 'text' },
  { key: 'shipping_address.address2', label: 'Address line 2', type: 'text' },
  { key: 'shipping_address.city', label: 'Delivery city', type: 'text' },
  { key: 'shipping_address.province', label: 'Delivery state', type: 'text' },
  {
    key: 'shipping_address.province_code',
    label: 'Delivery state code',
    type: 'text',
  },
  {
    key: 'shipping_address.country_code',
    label: 'Delivery country code',
    type: 'text',
  },
  { key: 'shipping_address.zip', label: 'Delivery postcode', type: 'text' },
  {
    key: 'has_shipping_address',
    label: 'Has delivery address',
    type: 'boolean',
  },
  {
    key: 'tracking_numbers',
    label: 'Tracking numbers',
    type: 'list',
    orderOnly: true,
  },
  {
    key: 'tracking_urls',
    label: 'Tracking URLs',
    type: 'list',
    orderOnly: true,
  },
  { key: 'quantity', label: 'Total item quantity', type: 'number' },
  {
    key: 'item_quantity',
    label: 'Quantity of a product, variant, SKU or collection',
    type: 'number',
  },
  { key: 'discount_codes', label: 'Discount codes', type: 'list' },
  { key: 'discount_total', label: 'Discount amount', type: 'number' },
  { key: 'created_at', label: 'Created at', type: 'date' },
  { key: 'age_hours', label: 'Age in hours', type: 'number' },
  {
    key: 'customer_order_count',
    label: 'Customer lifetime order count (latest)',
    type: 'number',
  },
  {
    key: 'previous_order_count',
    label: 'Orders before this order',
    type: 'number',
    orderOnly: true,
  },
  {
    key: 'is_first_order',
    label: 'Is first order',
    type: 'boolean',
    orderOnly: true,
  },
  {
    key: 'is_repeat_customer',
    label: 'Is repeat customer',
    type: 'boolean',
    orderOnly: true,
  },
];

export const CONDITION_OPERATOR_LABELS: Record<ConditionOperator, string> = {
  equals: 'equals',
  not_equals: 'does not equal',
  contains: 'contains',
  not_contains: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  present: 'is present',
  absent: 'is absent',
  gt: 'greater than',
  gte: 'greater than or equal',
  lt: 'less than',
  lte: 'less than or equal',
  between: 'between (inclusive)',
  in: 'is one of',
  not_in: 'is not one of',
  contains_any: 'contains any of',
  contains_all: 'contains all of',
  before: 'before',
  after: 'after',
};
export const CONDITION_OPERATORS = Object.keys(
  CONDITION_OPERATOR_LABELS
) as ConditionOperator[];
export function operatorsForField(
  type?: ConditionFieldType
): ConditionOperator[] {
  if (type === 'number')
    return [
      'equals',
      'not_equals',
      'gt',
      'gte',
      'lt',
      'lte',
      'between',
      'present',
      'absent',
    ];
  if (type === 'boolean') return ['equals', 'not_equals', 'present', 'absent'];
  if (type === 'list')
    return [
      'contains',
      'not_contains',
      'contains_any',
      'contains_all',
      'present',
      'absent',
    ];
  if (type === 'date') return ['before', 'after', 'present', 'absent'];
  if (type === 'enum')
    return ['equals', 'not_equals', 'in', 'not_in', 'present', 'absent'];
  return [
    'equals',
    'not_equals',
    'contains',
    'not_contains',
    'starts_with',
    'ends_with',
    'in',
    'not_in',
    'present',
    'absent',
  ];
}

export function operatorsForConditionField(
  field: ConditionField
): ConditionOperator[] {
  return field.operators
    ? [...field.operators]
    : operatorsForField(field.type);
}

export function shopifyConditionFields(subject: string): ConditionField[] {
  return SHOPIFY_CONDITION_FIELDS.filter(
    (f) => subject !== 'shopify_checkout' || !f.orderOnly
  );
}
export function isShopifySubject(subject?: string): boolean {
  return subject === 'shopify_order' || subject === 'shopify_checkout';
}

/** Own-property traversal only. Arrays are queried through explicit list fields. */
export function conditionPath(value: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (['__proto__', 'constructor', 'prototype'].includes(key))
      return undefined;
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}
export function conditionList(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
export function conditionNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' && typeof value !== 'string') return undefined;
  if (typeof value === 'string' && !value.trim()) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function compareCondition(args: {
  operator: ConditionOperator;
  subjectValue: unknown;
  configValue?: string;
  valueTo?: string;
  type?: ConditionFieldType;
}): boolean {
  const { operator, subjectValue: raw, configValue = '', valueTo, type } = args;
  const missing =
    raw == null || raw === '' || (Array.isArray(raw) && raw.length === 0);
  if (operator === 'present') return !missing;
  if (operator === 'absent') return missing;
  // Preserve legacy variable semantics; Shopify unknown values are handled by the resolver.
  if (raw == null) return operator === 'not_equals';
  const text = typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  const same =
    type === 'number'
      ? conditionNumber(raw) !== undefined &&
        conditionNumber(raw) === conditionNumber(configValue)
      : text === configValue;
  const values = conditionList(configValue);
  const includes = (v: string) =>
    Array.isArray(raw)
      ? raw.some((item) => String(item) === v)
      : text.includes(v);
  switch (operator) {
    case 'equals':
      return same;
    case 'not_equals':
      return !same;
    case 'contains':
      return includes(configValue);
    case 'not_contains':
      return !includes(configValue);
    case 'starts_with':
      return text.startsWith(configValue);
    case 'ends_with':
      return text.endsWith(configValue);
    case 'in':
      return values.includes(text);
    case 'not_in':
      return !values.includes(text);
    case 'contains_any':
      return values.length > 0 && values.some(includes);
    case 'contains_all':
      return values.length > 0 && values.every(includes);
    case 'before':
    case 'after': {
      const actual = Date.parse(text),
        expected = Date.parse(configValue);
      return (
        Number.isFinite(actual) &&
        Number.isFinite(expected) &&
        (operator === 'before' ? actual < expected : actual > expected)
      );
    }
    default: {
      const actual = conditionNumber(raw),
        expected = conditionNumber(configValue);
      if (actual === undefined || expected === undefined) return false;
      if (operator === 'gt') return actual > expected;
      if (operator === 'gte') return actual >= expected;
      if (operator === 'lt') return actual < expected;
      if (operator === 'lte') return actual <= expected;
      const upper = conditionNumber(valueTo);
      return (
        operator === 'between' &&
        upper !== undefined &&
        actual >= expected &&
        actual <= upper
      );
    }
  }
}

/** Shared save-time checks, also used for switch predicates. */
export function validateConditionPredicate(
  raw: Partial<ConditionPredicate>
): string[] {
  const errors: string[] = [];
  if (
    ![
      'var',
      'tag',
      'contact_field',
      'shopify_payment',
      'shopify_order',
      'shopify_checkout',
    ].includes(raw.subject ?? '')
  )
    errors.push('Pick a condition subject.');
  if (raw.subject !== 'shopify_payment' && !raw.subject_key?.trim())
    errors.push('Pick a field or enter a variable key.');
  if (!CONDITION_OPERATORS.includes(raw.operator!))
    errors.push('Pick a supported operator.');
  if (raw.data_source && !['snapshot', 'latest'].includes(raw.data_source))
    errors.push('Pick event snapshot or latest state.');
  if (raw.subject === 'shopify_checkout' && raw.data_source === 'latest')
    errors.push(
      'Checkout conditions use the event snapshot. Latest-state checks are available for Shopify orders.'
    );
  if (
    raw.subject === 'contact_field' &&
    !['name', 'email', 'phone', 'company'].includes(raw.subject_key ?? '')
  )
    errors.push('Pick a supported contact field.');
  const field = isShopifySubject(raw.subject)
    ? shopifyConditionFields(raw.subject!).find(
        (f) => f.key === raw.subject_key
      )
    : undefined;
  if (isShopifySubject(raw.subject) && !field)
    errors.push('Pick a supported Shopify field.');
  if (
    field &&
    raw.operator &&
    !operatorsForConditionField(field).includes(raw.operator)
  )
    errors.push('Operator is not supported for this field type.');
  if (
    field?.key === 'collection_ids' &&
    conditionList(raw.value).some((id) => !/^\d+$/.test(id))
  )
    errors.push('Pick collections from the list (numeric collection IDs).');
  if (
    raw.operator &&
    !['present', 'absent'].includes(raw.operator) &&
    !raw.value?.trim()
  )
    errors.push('Enter a comparison value.');
  if (
    ['in', 'not_in', 'contains_any', 'contains_all'].includes(
      raw.operator ?? ''
    ) &&
    conditionList(raw.value).length === 0
  )
    errors.push('Enter at least one list value.');
  if (
    field?.type === 'number' ||
    ['gt', 'gte', 'lt', 'lte', 'between'].includes(raw.operator ?? '')
  ) {
    if (
      !['present', 'absent'].includes(raw.operator ?? '') &&
      conditionNumber(raw.value) === undefined
    )
      errors.push('Enter a valid number.');
  }
  if (
    raw.operator === 'between' &&
    (conditionNumber(raw.value_to) === undefined ||
      Number(raw.value_to) < Number(raw.value))
  )
    errors.push('Enter an upper bound at least as large as the lower bound.');
  if (
    ['before', 'after'].includes(raw.operator ?? '') &&
    (!Number.isFinite(Date.parse(raw.value ?? '')) ||
      !/(Z|[+-]\d{2}:\d{2})$/i.test(raw.value ?? ''))
  )
    errors.push('Enter a date and time including timezone.');
  if (
    field?.type === 'boolean' &&
    !['present', 'absent'].includes(raw.operator ?? '') &&
    !['true', 'false'].includes(raw.value ?? '')
  )
    errors.push('Pick true or false.');
  const options =
    raw.subject === 'shopify_payment'
      ? PAYMENT_STATUSES
      : field?.type === 'enum'
        ? field.options
        : undefined;
  if (
    options &&
    !['present', 'absent'].includes(raw.operator ?? '') &&
    conditionList(raw.value).some(
      (v) => !(options as readonly string[]).includes(v)
    )
  )
    errors.push('Pick a supported status.');
  if (
    field?.key === 'item_quantity' &&
    (!(CONDITION_ITEM_KEYS as readonly string[]).includes(
      raw.item_key ?? ''
    ) ||
      !raw.item_value?.trim())
  )
    errors.push('Select the product, variant, SKU, name or collection to count.');
  if (
    field?.key === 'item_quantity' &&
    raw.item_key === 'collection_id' &&
    !/^\d+$/.test(raw.item_value?.trim() ?? '')
  )
    errors.push('Pick the collection from the list.');
  return errors;
}
