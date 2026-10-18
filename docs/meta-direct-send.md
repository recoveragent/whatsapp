# Meta Direct Send

Direct Send sends fully rendered utility content through the existing Cloud API messages endpoint with `category: "utility"`. Meta matches or generates a template, removing manual template preparation. Account eligibility and Meta policy enforcement still apply.

## Implemented scope

The inbox automatically uses **Direct Send · Utility text** when the 24-hour service window is closed. Inside the window, the composer sends regular service replies. A visible utility-only notice explains charges and content restrictions, and Templates remains available. Assignment, role and rate-limit checks remain active. Text is limited to 1024 characters. Drafts survive a failed send; errors appear on the failed message. Attachments and interactive actions are disabled in this mode. Replies inside the service window do not opt into utility delivery. API callers explicitly opt in with the category field.

The dashboard `/api/whatsapp/send` accepts `category: "utility"` with `message_type: "text"` and `content_text`. The public `/api/v1/messages` accepts the same category with its existing `type: "text"` and `text` fields. Invalid categories or non-text payloads are rejected before contact/conversation creation. Sent records retain `{ direct_send: true, category: "utility" }` in `content_payload`.

Use for transaction-specific order updates, receipts, appointment reminders and account notices. Promotional campaigns must use the approved marketing-template flow. Authentication, media headers, custom template naming and TTL are outside this implementation. Charges and account eligibility are decided by Meta; no automatic fallback is attempted.

## References

- https://developers.meta.com/resources/videos/whatsapp-direct-send-api/
- https://developers.facebook.com/documentation/business-messaging/whatsapp/direct-send

Meta's overview was accessible during research; the detailed documentation endpoint was unavailable through the browser tool. Verify account availability in WhatsApp Manager before a production send. No live customer messages were sent during implementation.
