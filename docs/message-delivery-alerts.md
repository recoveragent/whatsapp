# Message delivery alerts

Apply `supabase/migrations/20261023073935_message_failure_notifications.sql`
and deploy the app to enable alerts for newly failed outbound messages.
There is no backfill of older failures and no automatic retry or customer message.

The database creates notifications when an outbound message is inserted as
failed or changes to failed. This covers immediate send errors and later Meta
delivery webhooks for any messages stored in the inbox. Broadcast recipients
that have no corresponding inbox message are outside this alert path.

Recipients are the brand's owners/admins plus the conversation's assigned agent
if they are still a member. Child WhatsApp channels use parent-brand membership,
while notifications remain scoped to the affected channel. Existing notification
RLS and realtime publication remain in effect.

The header's **Delivery alerts** icon shows an unread badge and error details.
It updates through realtime with a 30-second polling fallback. Clicking an alert
marks it read and opens the affected chat. The Notifications page provides the
history and Mark all as read action. Meta error 131042 includes a prompt to check
WhatsApp billing, country/currency and the payment method in Meta Business Manager.

A unique recipient/message index prevents repeated webhook callbacks from
creating duplicate alerts, even after an out-of-order status update. Separate
failed messages generate separate alerts. Alerts are in-app; email, SMS and
desktop push are not configured.
