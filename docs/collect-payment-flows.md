# Collect payment in Flows

Each brand connects its own Razorpay API keys inside the Collect payment step.
These credentials are encrypted server-side and are independent of the platform's
wallet recharge gateway. This initial integration uses merchant API keys, not OAuth.

## Setup

1. Apply `20261018113952_flow_collect_payment.sql` to the deployment's Supabase database.
2. Ensure the existing `ENCRYPTION_KEY` (32-byte hex), `NEXT_PUBLIC_SITE_URL`, Supabase
   server credentials and `AUTOMATION_CRON_SECRET` are configured.
3. Under Flows, add **Collect payment**. An account admin connects the brand's
   Razorpay Key ID, Key Secret and a webhook secret (at least 16 characters).
   Keys are verified against Razorpay before saving. Use test keys for a dry run.
4. Add the displayed HTTPS webhook URL in Razorpay with the same secret. Subscribe
   to `payment_link.paid`, `payment_link.expired` and `payment_link.cancelled`.
5. Set the fixed advance in INR, description, expiry, reminder interval and count.
   The full fixed advance is collected; partial payment of that advance is disabled.
6. Choose approved WhatsApp templates without quick-reply buttons for the initial
   request and reminders. Map a body variable to `{{ vars.payment_url }}` or use
   `{{ vars.payment_url_suffix }}` for a dynamic URL button with base `https://rzp.io/`.
   Amount, description, reference and collection status are also available as variables.
7. Connect **Payment received** to a Send template node for the receipt. Connect
   **Payment link expired** and **Payment failed** to follow-up messages or handoff.
8. Schedule GET or POST `/api/flows/cron` every minute or every five minutes,
   sending `x-cron-secret: <AUTOMATION_CRON_SECRET>`. Both methods reconcile payments,
   send reminders and drain queued continuations. Webhooks try the paid branch
   immediately; the cron recovers missed callbacks and queued continuations.

## Behaviour

- A unique link is stored per run and payment node before sending its request.
- If the initial WhatsApp send fails, the payable link remains tracked and the
  flow still waits for payment. The failure is recorded in run history, and the
  configured reminder schedule can send the link again.
- The flow parks in `waiting`. Customer replies and “I paid” cannot confirm payment.
- Signed webhook events cause a server-to-server fetch from Razorpay. Link ID,
  reference, amount, currency and full payment must match before confirmation.
- Resolution and continuation enqueueing happen in one database transaction.
  Duplicate callbacks cannot queue duplicate receipts. Stopped runs are not revived.
- The configured templates, amount and branch destinations are snapshotted, so edits
  to the payment node do not change already-issued collections.
- Reminders recheck the gateway before sending, stop after payment/expiry, and are
  claimed to prevent overlapping cron jobs from sending duplicates. An ambiguous
  send failure leaves the reminder claimed and records `last_error` for investigation;
  operators should inspect delivery before clearing that claim.
- `payment_collection_status` is separate from the order's `payment_status`. A paid
  advance does **not** mean the full COD order is paid. No automatic order/courier
  balance updates are included; configure that integration separately.
- Failed customer payment attempts leave the link usable. The Failed branch handles
  setup errors and cancelled links. Unpaid links follow Expired after provider expiry.
- Connection replacement is blocked while collections are creating or pending.
- A lost response while creating a Razorpay link requires operator review in the
  gateway; creation is deliberately not blindly retried, to avoid duplicate links.

Before live use, test successful payment, unpaid reminder, expiry, invalid webhook
signature, duplicate webhook delivery and an agent stopping a waiting flow. Confirm
the merchant's webhook setup and WhatsApp template approval in the live accounts.
