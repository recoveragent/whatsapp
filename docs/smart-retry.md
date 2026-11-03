# Smart Retry for WhatsApp error 131049

Smart Retry captures outbound **marketing template** payloads sent from broadcasts,
flows/automations, the inbox, and the public messaging API. It only triggers on a
structured Meta error code `131049`, either an immediate API rejection or an
asynchronous failed-delivery webhook. Other error codes do not trigger recovery.

## Setup

1. Apply `supabase/migrations/20261103060121_smart_retry_131049.sql` using your normal migration deployment process.
2. Create and sync a re-engagement template for the sending WhatsApp number.
   It must be approved, have exactly one QUICK_REPLY button, no media header,
   and no variables other than optional `{{1}}` in the body for the company name.
   A fixed text header is supported.
3. Open **Settings → Inbox → Smart Retry**, enter your company name, select the
   approved template for that number, enable the feature, and save.

Suggested body: `A message from {{1}} is waiting to be delivered. Tap below to receive it.`
Suggested button: `Receive message`.

Select the correct Meta-approved category for the actual purpose. This feature
accepts approved Utility or Marketing templates; it does not submit a template,
promise Utility approval, or change its category. A re-engagement prompt intended
to recover promotional content may be classified as Marketing. Delivery of the
prompt or retried marketing template is not guaranteed.

## Behavior

- Disabled by default, configured separately for each WhatsApp number.
- Stores the actual outgoing template payload, without access tokens, so recovery
  preserves body/header variables, media, language, URL and quick-reply payloads.
- Sends at most one recovery prompt per recipient per number in a rolling 24 hours.
  Failures during the prompt consume that cooldown too.
- A message snapshot expires 48 hours after its original send attempt. Expired
  messages cannot be accepted. The panel labels expired pending attempts.
- Acceptance requires the signed webhook's account, number, recipient, recovery
  token, and quoted prompt message ID to match. Button labels alone cannot trigger it.
- Uses atomic conditional updates for single-use claims. Duplicate failure webhooks
  and repeated taps cannot resend the same message twice.
- Checks that settings remain enabled, the channel remains connected, the original
  marketing template remains approved, and the wallet can fund the send.
- Cancels pending recovery if the original message subsequently delivers.
- The acceptance is stored as an inbound message, but does not trigger flows,
  keyword automations, or AI replies. It does not restart a flow or advance a node.
- The resend appears as a separate inbox message. For asynchronous broadcast
  failures, the recipient is relinked to the resend so delivery status and counters
  can recover. The recovery record retains both original and retry message IDs.
- Wallet checks and normal per-template debits apply to the prompt and resend.
- No further prompt or retry is scheduled if either recovery send fails. Ambiguous
  network outcomes are not automatically replayed, preventing duplicate sends.
- Recent recovery attempts and failures are visible in the settings panel.

The initial release captures new sends after enabling the setting. It does not
backfill earlier failures, replay every failed campaign for a recipient, or resend
old messages when the recipient sends an unrelated reply.

## Verification

The unit tests cover eligibility, immediate rejections, original delivery,
expiry, disabled settings, template pauses, recipient/account/channel/prompt
matching, cooldown, duplicate webhooks, duplicate clicks, and recovery failures.
The PGlite integration suite executes the migration and verifies RLS/privileges,
unique message snapshots, rolling cooldown claims, and conditional acceptance.
No test sends a live WhatsApp message.
