# Meta Direct Send

Direct Send sends fully rendered utility content through the existing Cloud API messages endpoint with `category: "utility"`. Meta matches or generates a template, removing manual template preparation. Account eligibility and Meta policy enforcement still apply.

## Availability per connected account

Apply migration `20261021064434_whatsapp_direct_send_availability.sql` before deploying. Existing and new WhatsApp configurations start with `direct_send_status: unknown`. Available values are `unknown`, `enabled`, and `unavailable`.

Settings → WhatsApp number shows availability. Workspace admins and ops can record confirmed access. Selecting Enabled requires an explicit confirmation that Meta has enabled the feature for the connected account. This records access; it does not request or grant Meta access. Ordinary agents can read status but cannot edit it. Ops can also manage it on each brand's WhatsApp setup page.

## Inbox behavior

Inside the 24-hour service window, the composer uses regular service replies. Outside it, only accounts with confirmed Enabled status automatically use Direct Send. Unknown or Unavailable accounts see a compact template prompt with the free-text input disabled. Templates remain available in every mode.

The Direct Send bar is compact, with guidance in a help popover. Text is limited to 1024 characters. Failed sends retain the draft. A Meta eligibility rejection changes only the connected configuration to Unavailable and returns `DIRECT_SEND_UNAVAILABLE`; the inbox immediately switches to the template prompt. Network errors and content-policy failures do not change availability. No retry as a template or service message is attempted. Replacing the number/WABA or disconnecting resets access to Unknown.

## APIs

`GET /api/whatsapp/direct-send?config_id=…` returns account-scoped availability without credentials. `PATCH /api/whatsapp/direct-send` requires admin role and `{ config_id, status, meta_access_confirmed: true }` when enabling. Ops equivalents are at `/api/admin/brands/[id]/whatsapp/direct-send` and require super-admin brand authorization.

The dashboard `/api/whatsapp/send` accepts `category: "utility"` with `message_type: "text"` and `content_text`. Public `/api/v1/messages` uses the same category with its existing `type: "text"` and `text` fields. Both send paths enforce confirmed access server-side. Sent records retain `{ direct_send: true, category: "utility" }` in `content_payload`.

Use for transaction-specific order updates, receipts, appointment reminders and account notices. Promotions must use approved marketing templates. Authentication, media headers, custom template naming and TTL remain outside this implementation.

## References

- https://developers.meta.com/resources/videos/whatsapp-direct-send-api/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send

Meta's overview was accessible during research; the detailed documentation endpoint was unavailable through the browser tool. Verify account availability in WhatsApp Manager before a production send. No live customer messages were sent during implementation.
