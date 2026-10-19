# WhatsApp delivery timing

Open Flows → Runs, expand a run, then expand **Delivery timing** on a message-sent
event. Refresh the page after delivery to load the latest callbacks.

For new template messages sent by flows/automations or the shared inbox sender,
the system records the API request start, response time, request duration and
Meta's `message_status` (including `held_for_quality_assessment` when reported).
The signed WhatsApp webhook records provider sent/delivered/read/failed timestamps
and the time our endpoint received the callback. Times display in the browser's
timezone.

This separates flow processing before the API call, API request duration,
response-to-delivery time and callback arrival delay. An accepted API response is
not proof of delivery. If Meta omits a hold status, we display that it was not
reported; we do not infer that no hold occurred. Missing callback timestamps stay
unavailable rather than being replaced with local message creation times.

Events are stored independently of inbox messages so a callback can arrive first.
They are deduplicated by account, WhatsApp phone ID, message ID, event type and
provider timestamp; an out-of-order `sent` callback cannot erase a `delivered` or
`read` timing. Writes use the server role; members can read only their brand's
events through RLS. Logging failures are non-fatal and never trigger a second send.

Apply `20261019182734_whatsapp_delivery_diagnostics.sql` before deploying the code.
Historical timings cannot be reconstructed. No customer message or test payment
is sent by enabling this feature.
