/** Shape of a Fastrr (Shiprocket) checkout mirrored by Recover Agent, with test details. */
export function fastrrPayload(
  item: Record<string, unknown> = {},
  /** Recover Agent's flat fields, e.g. cash_on_delivery_total_amount. */
  flat: Record<string, unknown> = {}
) {
  const address = {
    zip: '560001',
    city: 'Bengaluru',
    name: 'Test Customer',
    phone: '9876543210',
    state: 'Karnataka',
    line_1: '12 Test Road',
    country: 'India',
    address1: '12 Test Road',
    last_name: 'Customer',
    first_name: 'Test',
    country_code: 'IN',
  };
  return {
    _wa_recover_agent_mirror: true,
    event: {
      event: 'abandoned_checkout',
      phone: '919876543210',
      amount: 1199,
      checkout_id: 'wh-test',
      flat,
      raw: {
        tax: 0,
        email: 'test@example.com',
        items: [
          {
            sku: 'TEST-1',
            name: 'Photo frame',
            price: 1199,
            title: 'Photo frame',
            quantity: 1,
            product_id: 8596262879457,
            variant_id: 45394003034337,
            ...item,
          },
        ],
        currency: 'INR',
        source_name: 'fastrr',
        total_price: 1199,
        phone_number: '9876543210',
        discount_codes: [''],
        payment_status: 'Pending',
        shipping_price: 0,
        total_discount: 0,
        billing_address: address,
        shipping_address: address,
      },
    },
  };
}
