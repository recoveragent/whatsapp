# Cashfree flow collections

Cashfree and Razorpay can both stay connected for a brand. Choose the gateway in
the Collect payment node; existing requests keep the provider in their saved
configuration, even if the flow is edited later.

## Setup

1. Apply `20261019114450_cashfree_flow_collections.sql` before deploying the app.
2. Open Flows → Collect payment → Gateway → Cashfree.
3. As a brand admin, enter the Cashfree App ID and Secret Key and select Production
   or Sandbox. Credentials are encrypted on the server, never returned to clients.
4. Add the displayed URL (`/api/payments/cashfree/webhook/<accountId>`) in Cashfree
   for Payment Link events (`PAYMENT_LINK_EVENT`). Cashfree signs events with the
   Secret Key; there is no separate webhook secret to invent.
5. Create and approve a payment template in Settings → Templates. Select Payment
   purpose, choose Cashfree (or Cashfree sandbox), and use the suggested CTA.
6. Map body amount to `{{ vars.payment_amount }}` and URL button to
   `{{ vars.payment_url_suffix }}`. Production templates use
   `https://payments.cashfree.com/{{1}}`; sandbox templates use
   `https://payments-test.cashfree.com/{{1}}`. Existing Razorpay templates keep
   `https://rzp.io/{{1}}`. Use separate templates for different domains, or put the
   full `{{ vars.payment_url }}` in the message body.
7. Configure request/reminder templates and Paid/Expired/Failed branches.

The existing flows cron must remain scheduled for reminders and missed-webhook
recovery. Each signed webhook is followed by a server-side Cashfree fetch. The
collection ID, currency, amount and fully paid amount must match before the
shared transactional resolver advances the run. Partial payments are disabled.
Failed attempts leave an active link available for retry; a cancelled link follows
Failed. Credentials cannot be replaced while that gateway has pending collections.

No Cashfree SDK is needed: the adapter uses server-side fetch with API version
`2026-01-01`, timeouts and an idempotency key for link creation. Connection
verification fetches a deliberately nonexistent link (authenticated 404), without
creating an actual payment request. A real sandbox payment still needs merchant
credentials and webhook configuration.

References:
- [Cashfree Create Payment Link](https://www.cashfree.com/docs/api-reference/payments/latest/payment-links/create-payment-link)
- [Cashfree webhook signature verification](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification)
- [Cashfree official payment-link API reference](https://github.com/cashfree/cashfree-pg/blob/main/docs/PaymentLink.md)

## Existing Razorpay templates

An approved URL button keeps its original domain. Changing the flow gateway does
not change an approved template. Create and approve a Cashfree version and select
it for both the payment request and reminders. Activation and collection setup
reject mismatched payment buttons before creating a link. Runtime template
lookups use APPROVED rows and fail on query errors; a pending draft with the same
name cannot bypass URL checks.
