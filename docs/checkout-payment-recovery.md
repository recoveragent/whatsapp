# Checkout recovery with COD and UPI

Super Admin → Global flows contains **Abandoned checkout — COD or UPI**.
Apply it to selected brands to create draft copies. Applying does not activate a flow,
send messages, request payments, or place orders.

## Configure each brand

1. Deploy the application changes and apply migration
   `20261026175011_checkout_recovery_orders.sql` before activating any copies.
2. Connect Shopify with `read_orders`, `write_orders`, `read_products`,
   `read_customers`, `write_customers`, `read_draft_orders`, and `write_draft_orders`.
   Existing installations need to approve any newly requested permissions.
3. Push the **Checkout recovery — payment choice** and **Checkout recovery — payment
   request** template presets from Super Admin → Templates. Supply a sample product
   image for Meta approval, then select the approved brand templates in the flow.
   In the choice message step, upload the brand's fallback header image (JPEG or
   PNG). It is sent when a checkout has no product image; activation requires it.
   The choice template has Cash on Delivery and Pay by UPI quick replies. At runtime,
   its image, customer name, items, total and address come from the checkout.
4. In **Review COD checkout**, choose either automatic Shopify order creation or
   checkout-page routing. Automatic creation first displays the authoritative Shopify
   items, total and shipping address, then requires a separate confirmation button tap.
   Typing a confirmation cannot create the COD order.
5. Connect the brand's Razorpay account and webhook in **Collect payment**. The preset
   uses a UPI payment link, a one-hour expiry and one reminder. Existing payment nodes
   keep their hosted-checkout behavior unless changed. Cashfree is also supported by
   the existing payment node. Payment authorization happens on the gateway/UPI app.
6. Use the checkout-app trigger for Recover Agent mirrors or the flow's checkout-app
   webhook. Native Shopify stores can change the trigger to **Shopify: abandoned
   checkout** and set their abandonment delay. Review overlapping recovery flows and
   the legacy campaign before activating to avoid sending two recovery messages.

## Order and payment behavior

- Server-owned saved checkout data supplies variant IDs, quantities, currency,
  shipping address and the selected shipping rate. Product names in template variables
  are never used to select products for an order.
- A draft order calculates the total in Shopify. Automatic recovery requires INR,
  an Indian shipping address, and an exact match with the original checkout total.
  Missing details, personalized products, subscriptions, bundles, partner charges,
  gift cards and credits use the checkout fallback or agent assistance.
- The displayed COD summary uses the actual draft's items and address. Its fingerprint
  prevents creating an order after a change to those details. Quotes expire after
  fifteen minutes; inventory is reserved while the quote/payment request is valid.
- COD orders remain unpaid, have payment terms due on fulfillment, and carry
  `whatsapp-cod` plus payment-method and recovery-reference attributes. This is an
  order created through the app; it does not run the checkout partner's risk checks,
  fees, payment selection, or fulfillment-specific rules. Merchant courier workflows
  must recognize the COD tag/attributes and outstanding amount.
- Online recovery collects the verified checkout total. The signed gateway webhook
  and provider lookup verify payment. Shopify then completes the same draft and
  records it paid. The order confirmation is withheld until this succeeds.
- A failed Shopify update is retried by the existing payment sync worker. After its
  retry limit, the flow hands off to an agent and retains the **paid** payment status.
  It never asks the customer to pay again. Stopped flows are never revived.
- One recovery record per brand/checkout and completion of one Shopify draft prevent
  duplicate orders. An online payment request prevents COD placement for that checkout.
  Ambiguous draft creation is retained for manual reconciliation rather than retried
  as a second draft. Search Shopify drafts by the `wa-recovery-<reference>` tag.
- Live purchase history is checked before quoting or completing a new order. If
  Shopify cannot confirm history or too many recent orders require review, recovery
  stops or routes to checkout/assistance. A purchase on the original checkout can still
  race a recovery operation; agents must reconcile a paid request if another order
  already exists. The app cannot atomically lock an independent checkout partner.

Checkout routing opens the original secure checkout URL. COD preselection requires a
checkout-partner integration and is not assumed for a generic URL.

## Verification

Tests cover checkout normalization, inventory and amount checks, customer ownership,
COD confirmation, reuse of one Shopify draft, verified prepaid completion, branch
connections, payment/order reconciliation, stopped flows, duplicate callbacks and
brand isolation. They do not create orders or collect money in production.
