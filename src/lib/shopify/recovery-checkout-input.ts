/** Only structured checkout data is accepted. Display names/prices are never order inputs. */
type Row = Record<string, unknown>;
const row = (v: unknown): Row =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Row) : {};
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const hasEntries = (v: unknown) =>
  !!v && typeof v === 'object' && Object.keys(v).length > 0;
function money(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  return Number(v);
}

export interface RecoveryCheckoutInput {
  expectedPaise: number;
  phone: string;
  checkoutToken: string;
  draftInput: Record<string, unknown>;
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
    // Shopify sends line item properties; Fastrr sends custom_attributes.
    // An order created without them would lose the customer's personalization.
    if (hasEntries(item.properties) || hasEntries(item.custom_attributes))
      throw new Error(
        'Personalized items must be completed on the checkout page.'
      );
    return { variantId: `gid://shopify/ProductVariant/${variant}`, quantity };
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
    phone: text(address.phone ?? event.phone),
  };
  if (
    !shippingAddress.firstName ||
    !shippingAddress.address1 ||
    !shippingAddress.city ||
    !shippingAddress.province ||
    !/^\d{6}$/.test(shippingAddress.zip)
  )
    throw new Error('A complete shipping address is required.');
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
  const phone = text(event.phone ?? address.phone ?? row(raw.customer).phone);
  const email = text(raw.email ?? row(raw.customer).email);
  return {
    expectedPaise,
    phone,
    checkoutToken: text(raw.token ?? event.token),
    draftInput: {
      lineItems,
      shippingAddress,
      shippingLine: {
        title: text(shipping.title ?? shipping.name) || 'Shipping',
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
