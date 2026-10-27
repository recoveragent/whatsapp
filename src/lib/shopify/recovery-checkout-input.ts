/** Only structured checkout data is accepted. Display names/prices are never order inputs. */
type Row = Record<string, unknown>;
const row = (v: unknown): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * Personalization as Shopify line item attributes. Fastrr sends an object of
 * custom_attributes; Shopify sends properties as [{ name, value }] or an object.
 * Fastrr's own orders store these under the same names, so apps such as
 * Teeinblue read a recovered order the same way.
 */
function lineAttributes(item: Row): Array<{ key: string; value: string }> {
  const pairs = [item.custom_attributes, item.properties].flatMap((source) =>
    Array.isArray(source)
      ? source.map((p) => [row(p).name ?? row(p).key, row(p).value] as const)
      : Object.entries(row(source))
  );
  const seen = new Set<string>();
  return pairs.flatMap(([rawKey, rawValue]) => {
    const key = typeof rawKey === 'string' ? rawKey.trim() : '';
    if (!key || seen.has(key) || rawValue === null || rawValue === undefined)
      return [];
    if (typeof rawValue === 'object')
      throw new Error('Checkout has an unsupported personalization value.');
    seen.add(key);
    return [{ key, value: String(rawValue) }];
  });
}
/**
 * Shopify needs international (E.164) phones. Fastrr sends "919876543210" and
 * address phones as "9876543210". Indian numbers become +91XXXXXXXXXX; other
 * "+" numbers are kept; anything else is '' and left off the draft.
 */
export function shopifyPhone(value: unknown): string {
  const raw = typeof value === 'number' ? String(value) : text(value);
  const digits = raw.replace(/\D/g, '');
  const local =
    digits.length === 10
      ? digits
      : digits.length === 11 && digits.startsWith('0')
        ? digits.slice(1)
        : digits.length === 12 && digits.startsWith('91')
          ? digits.slice(2)
          : '';
  if (/^[6-9]\d{9}$/.test(local)) return `+91${local}`;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15)
    return `+${digits}`;
  return '';
}

function money(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

export type RecoveryPaymentMethod = 'cod' | 'prepaid';

export interface RecoveryCheckoutInput {
  /** Checkout total, which prepaid orders pay. */
  expectedPaise: number;
  /** Extra charged for Cash on Delivery, added to shipping as the checkout partner does. */
  codChargePaise: number;
  phone: string;
  checkoutToken: string;
  /** Prepaid draft input; use draftInputFor for a payment method. */
  draftInput: Record<string, unknown>;
}

export function quotePaise(
  input: RecoveryCheckoutInput,
  method: RecoveryPaymentMethod
): number {
  return input.expectedPaise + (method === 'cod' ? input.codChargePaise : 0);
}

/** Labels shipping like Fastrr ("Standard (COD)") and adds the COD charge to it. */
export function draftInputFor(
  input: RecoveryCheckoutInput,
  method: RecoveryPaymentMethod
): Record<string, unknown> {
  const line = input.draftInput.shippingLine as {
    title: string;
    priceWithCurrency: { amount: string; currencyCode: string };
  };
  const price =
    Number(line.priceWithCurrency.amount) +
    (method === 'cod' ? input.codChargePaise / 100 : 0);
  return {
    ...input.draftInput,
    shippingLine: {
      title: `${line.title} (${method === 'cod' ? 'COD' : 'Prepaid'})`,
      priceWithCurrency: { ...line.priceWithCurrency, amount: price.toFixed(2) },
    },
  };
}

export function recoveryCheckoutInput(payload: unknown): RecoveryCheckoutInput {
  const envelope = row(payload);
  const mirror = envelope._wa_recover_agent_mirror === true;
  const event = mirror ? row(envelope.event) : envelope;
  const raw = mirror ? row(event.raw) : event;
  if (raw.completed_at || raw.order_id || raw.is_abandoned === false)
    throw new Error('This checkout has already been completed.');
  const currency = text(raw.currency).toUpperCase();
  if (currency !== 'INR')
    throw new Error('Automatic recovery requires an INR checkout.');
  // Partner-specific fees, credits and subscriptions must be handled by that checkout.
  for (const key of [
    'cod_charges',
    'convenience_fees',
    'gift_card_total',
    'store_credits',
    'c2p_discount',
    'prepaid_dis_val',
    'payment_offer_discount',
  ]) {
    if (raw[key] && money(raw[key]) !== 0)
      throw new Error(
        'This checkout has partner-specific charges or credits. Complete it on the checkout page.'
      );
  }
  if (raw.subscription)
    throw new Error(
      'Subscription checkouts must be completed on the checkout page.'
    );
  const items = raw.line_items ?? raw.items;
  if (!Array.isArray(items) || !items.length || items.length > 50)
    throw new Error('Checkout product variants are missing.');
  const lineItems = items.map((value) => {
    const item = row(value);
    const variant = String(item.variant_id ?? '').replace(
      /^gid:\/\/shopify\/ProductVariant\//,
      ''
    );
    const quantity = Number(item.quantity);
    if (
      !/^\d+$/.test(variant) ||
      !Number.isSafeInteger(quantity) ||
      quantity < 1 ||
      quantity > 100
    )
      throw new Error('Checkout has an invalid product variant or quantity.');
    if (item.selling_plan_allocation || item.has_components === true)
      throw new Error('Bundles and subscriptions must use the checkout page.');
    const customAttributes = lineAttributes(item);
    return {
      variantId: `gid://shopify/ProductVariant/${variant}`,
      quantity,
      ...(customAttributes.length ? { customAttributes } : {}),
    };
  });
  const address = row(raw.shipping_address ?? raw.address);
  const country = text(address.country_code ?? address.country).toUpperCase();
  if (!['IN', 'INDIA'].includes(country))
    throw new Error(
      'Automatic recovery currently requires an Indian shipping address.'
    );
  const shippingAddress = {
    firstName: text(address.first_name ?? address.firstname),
    lastName: text(address.last_name ?? address.lastname),
    address1: text(address.address1 ?? address.address),
    address2: text(address.address2 ?? address.additional),
    city: text(address.city),
    province: text(address.province ?? address.state),
    zip: text(address.zip ?? address.pincode),
    countryCode: 'IN',
  };
  const addressPhone = shopifyPhone(address.phone ?? event.phone);
  if (
    !shippingAddress.firstName ||
    !shippingAddress.address1 ||
    !shippingAddress.city ||
    !shippingAddress.province ||
    !/^\d{6}$/.test(shippingAddress.zip)
  )
    throw new Error('A complete shipping address is required.');
  if (addressPhone) Object.assign(shippingAddress, { phone: addressPhone });
  const shipping = Array.isArray(raw.shipping_lines)
    ? row(raw.shipping_lines[0])
    : row(raw.shipping);
  // Fastrr has no shipping line, only a top-level shipping_price.
  const shippingPrice = money(
    shipping.price ??
      (Array.isArray(raw.shipping_lines) ? undefined : raw.shipping_price)
  );
  if (!Number.isFinite(shippingPrice) || shippingPrice < 0)
    throw new Error('The selected shipping rate is missing.');
  if (shipping.cod_charges && money(shipping.cod_charges) !== 0)
    throw new Error('COD charges must be handled by the checkout partner.');
  const expected = money(mirror ? event.amount : raw.total_price);
  const expectedPaise = Math.round(expected * 100);
  if (!Number.isSafeInteger(expectedPaise) || expectedPaise < 100)
    throw new Error('The checkout total is missing or invalid.');
  // Recover Agent reports the checkout partner's COD total (Fastrr adds a COD
  // shipping charge). Without it, COD costs the checkout total.
  const codTotalPaise = Math.round(
    money(row(event.flat).cash_on_delivery_total_amount) * 100
  );
  const codChargePaise =
    mirror && Number.isSafeInteger(codTotalPaise) && codTotalPaise >= expectedPaise
      ? codTotalPaise - expectedPaise
      : 0;
  const rawPhone = text(
    event.phone ?? address.phone ?? row(raw.customer).phone
  );
  // The same international phone is used for the draft and customer linking.
  const phone = shopifyPhone(rawPhone);
  const email = text(raw.email ?? row(raw.customer).email);
  return {
    expectedPaise,
    codChargePaise,
    phone: phone || rawPhone,
    checkoutToken: text(raw.token ?? event.token),
    draftInput: {
      lineItems,
      shippingAddress,
      shippingLine: {
        title: text(shipping.title ?? shipping.name) || 'Standard',
        priceWithCurrency: {
          amount: shippingPrice.toFixed(2),
          currencyCode: 'INR',
        },
      },
      presentmentCurrencyCode: 'INR',
      acceptAutomaticDiscounts: true,
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
      ...(Array.isArray(raw.discount_codes)
        ? {
            // Shopify sends { code } objects; Fastrr sends plain strings.
            discountCodes: raw.discount_codes
              .map((v) => text(typeof v === 'string' ? v : row(v).code))
              .filter(Boolean),
          }
        : {}),
    },
  };
}
