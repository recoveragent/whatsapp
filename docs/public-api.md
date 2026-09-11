# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** Stable. Authentication, scopes, rate limiting, the
> messages / contacts / conversations / broadcasts endpoints, and
> outbound event [webhooks](#webhooks) all ship now. Recover Agent
> integration endpoints (`GET /api/v1/templates`, `POST /api/v1/send`,
> `POST /api/v1/events/abandoned-checkout`, and
> `POST /api/v1/events/product-link-sent`) also ship now.

## Authentication

Every request authenticates with an **API key**, sent as a bearer
token:

```
Authorization: Bearer wacrm_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Keys are **account-scoped**: a key acts on exactly one account, the
one it was created in. There is no cross-account access.

### Creating a key

In the dashboard: **Settings → API keys → New API key**. Only
**admins and owners** can create keys.

1. Give the key a name (after the integration that will use it).
2. Grant the **scopes** it needs — nothing more (see below).
3. Copy the key. **The full key is shown exactly once.** wacrm
   stores only a SHA-256 hash, so it can never be shown again. If you
   lose it, revoke it and create a new one.

### Revoking a key

**Settings → API keys → Revoke.** Revocation is effective on the
key's next request. Revoked keys stay in the list as an audit trail.

## Scopes

A key can do only what its scopes allow — independent of who created
it. Grant the minimum.

| Scope                | Allows                                   |
| -------------------- | ---------------------------------------- |
| `messages:send`      | Send WhatsApp messages                   |
| `messages:read`      | Read messages and delivery status        |
| `templates:read`     | List approved WhatsApp message templates |
| `contacts:read`      | List and read contacts                   |
| `contacts:write`     | Create and update contacts               |
| `conversations:read` | List and read conversations              |
| `broadcasts:send`    | Launch broadcast campaigns               |
| `webhooks:manage`    | Register and manage outbound webhooks    |

A key with **no scopes** still authenticates and can call
`GET /api/v1/me` — useful for verifying a key works.

## Response envelope

Every response uses one of two shapes:

```jsonc
// success
{ "data": { /* ... */ } }

// failure
{ "error": { "code": "forbidden", "message": "This API key is missing the 'messages:send' scope" } }
```

Branch on `error.code` (stable); `error.message` is for humans and
may be reworded.

| Status | `code`         | Meaning                                          |
| ------ | -------------- | ------------------------------------------------ |
| 401    | `unauthorized` | Missing / malformed / unknown / revoked / expired key |
| 403    | `forbidden`    | Valid key, but missing the required scope        |
| 429    | `rate_limited` | Per-key rate limit exceeded                      |
| 400    | `bad_request`  | Malformed input                                  |
| 404    | `not_found`    | No such resource                                 |
| 500    | `internal`     | Server error                                     |

## Rate limits

Requests are limited **per key**: **120 requests per minute**. On a
`429`, these headers tell you when to retry:

- `Retry-After` — seconds until the window resets
- `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`

> The limiter is in-memory and **per process**. A single-instance
> deploy (the common case for a self-hosted fork) is fine as-is. If
> you scale to multiple instances, swap the limiter for a shared
> store (Redis/Upstash) — see the note at the top of
> `src/lib/rate-limit.ts`. The limit is otherwise unenforced across
> instances.

## Endpoints

### `GET /api/v1/me`

Returns the account a key is bound to and the scopes it carries.
Requires only a valid key (no scope). Use it to verify a key works
and to discover its scopes.

```bash
curl https://your-crm.example.com/api/v1/me \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "data": {
    "account": { "id": "…", "name": "Acme Inc" },
    "key": { "id": "…", "scopes": ["messages:send"] }
  }
}
```

### `GET /api/v1/templates`

Lists **APPROVED** WhatsApp templates for the brand tied to the API
key. Used by Recover Agent (and other integrators) to populate a
template dropdown.

**Scope:** `templates:read` **or** `messages:send`

```bash
curl https://wa.recoveragent.ai/api/v1/templates \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "templates": [
    {
      "id": "cod_call_not_connected_v1",
      "name": "Cod Call Not Connected V1",
      "params": ["body_1", "body_2", "body_3"],
      "param_count": 3,
      "language": "en_US",
      "category": "Utility",
      "body": "Hi {{1}}, your COD order {{2}} for {{3}} needs confirmation.",
      "header": "Order update",
      "header_type": "text",
      "footer": "Reply STOP to opt out",
      "buttons": [{ "type": "QUICK_REPLY", "text": "Confirm order" }]
    }
  ]
}
```

- `id` is the Meta template **name** — pass it as `template_id` on send.
- `body`, `header`, `footer`, and `buttons` carry the approved template
  text for integrator previews (placeholders stay as Meta `{{N}}`).
- `params` lists variable slots in send order. Use these keys when
  sending object-style `params`, or pass a positional string array.

### `GET /api/v1/templates/{id}`

Returns one approved template with the same fields as a list item.
Accepts the Meta template name or the wacrm UUID.

```bash
curl https://wa.recoveragent.ai/api/v1/templates/cod_not_picked_up \
  -H "Authorization: Bearer wacrm_live_xxx"
```

```json
{
  "id": "cod_not_picked_up",
  "name": "Cod Not Picked Up",
  "params": ["body_1"],
  "param_count": 1,
  "language": "en_US",
  "category": "Utility",
  "body": "Hi {{1}}, we tried calling about your COD order but couldn't reach you.",
  "header": "Order update",
  "buttons": [{ "type": "QUICK_REPLY", "text": "Call me back" }]
}
```

### `POST /api/v1/send`

Send an approved template to a phone number. **Synchronous** — waits
for Meta to accept the message and returns `200` with the WhatsApp
message id (not `202` queued).

**Scope:** `messages:send`

```bash
curl https://wa.recoveragent.ai/api/v1/send \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "template_id": "cod_call_not_connected_v1",
    "phone": "+919876543210",
    "params": {
      "customer_name": "Rahul",
      "order_name": "#1234",
      "product": "Blue Tee"
    },
    "metadata": {
      "company_id": "uuid-from-recover-agent",
      "journey": "cod",
      "stage": "call_not_connected"
    }
  }'
```

**Success (`200`):**

```json
{
  "status": "sent",
  "message_id": "wamid.HBgM…",
  "whatsapp_message_id": "wamid.HBgM…",
  "conversation_id": "…"
}
```

**Errors** use the standard envelope:

```json
{ "error": { "code": "bad_request", "message": "phone must be a valid E.164 number" } }
```

| Status | `code`                 | When                                      |
| ------ | ---------------------- | ----------------------------------------- |
| 402    | `insufficient_balance` | Brand wallet cannot cover the template    |
| 404    | `not_found`            | Unknown / unapproved `template_id`        |
| 502    | `provider_error`       | Meta rejected the send                    |

`metadata` is stored on the outbound message for ops tracing; it does
not affect routing. Recover Agent's `company_id` is opaque to wacrm —
the API key already identifies the brand (`account_id` → WABA).

### `POST /api/v1/events/abandoned-checkout`

Recover Agent mirrors each accepted abandoned-checkout webhook here
when a brand enables **Also forward to WhatsApp API**. The endpoint
responds quickly (`202`) and queues work for `fire_after`.

**Scope:** `messages:send` **or** `contacts:write`

```bash
curl https://wa.recoveragent.ai/api/v1/events/abandoned-checkout \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "abandoned_checkout",
    "checkout_id": "abc123",
    "token": "abc123",
    "phone": "+919876543210",
    "customer_name": "Asha",
    "product": "Men'\''s Cotton Boxer - XL",
    "amount": 999,
    "checkout_url": "https://store.com/checkouts/abc123",
    "address1": "12 MG Road",
    "city": "Bengaluru",
    "state": "KA",
    "zip": "560001",
    "fire_after": "2026-09-10T12:00:00.000Z",
    "flat": {},
    "raw": {},
    "metadata": {
      "company_id": "uuid",
      "workflow_slug": "shopify_webhook_abc_ingest",
      "queue_id": "uuid",
      "source": "abc_webhook_intake"
    }
  }'
```

**Success (`202`):**

```json
{ "ok": true }
```

**Behavior:**

1. **Ingest on receipt** — upserts the contact (phone + name) so the
   cart appears in the WA CRM immediately.
2. **Send at `fire_after`** — queues the event and, when due, starts
   active **Shopify: abandoned checkout (checkout app)** flows and/or
   the legacy **abandoned_checkout** campaign if enabled.
3. **Dedupe** — one pending row per `(account_id, checkout_id)`; later
   mirrors for the same checkout update the payload and reschedule
   `fire_after`.

`flat` carries Flows payload-map fields; `raw` is the original
provider webhook body (Shopify, GoKwik, etc.). `fire_after` aligns
with Recover Agent's voice/call delay — WA waits until that timestamp
before sending.

Errors use the standard envelope (`{ "error": { "code", "message" } }`).

### `POST /api/v1/events/product-link-sent`

Send a Sell on WhatsApp product card (Shopify checkout link) from an
external integration. Optionally schedules product link recovery when
enabled on the brand.

**Scope:** `messages:send`

```bash
curl https://wa.recoveragent.ai/api/v1/events/product-link-sent \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "conversation_id": "uuid",
    "shopify_variant_id": "40123456789",
    "quantity": 1,
    "schedule_recovery": true
  }'
```

**Success (`202`):**

```json
{
  "data": {
    "product_send_id": "uuid",
    "checkout_url": "https://store.myshopify.com/cart/40123456789:1"
  }
}
```

### `POST /api/v1/messages`

Send a WhatsApp message to a phone number. Scope: `messages:send`. You
pass an **E.164 number**, not an internal id — the endpoint
finds-or-creates the contact + conversation, then sends.

```bash
curl -X POST https://your-crm.example.com/api/v1/messages \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+14155550123", "type": "text", "text": "Hi 👋" }'
```

`type` is `text` (default), `template`, or a media kind (`image` /
`video` / `document` / `audio`). Media needs `media_url` (and optional
`filename`); `text` doubles as the caption. `template` needs a
`template` object:

```jsonc
{
  "to": "+14155550123",
  "type": "template",
  "template": {
    "name": "order_update",
    "language": "en_US",
    "params": ["A123"]        // positional body vars, or a structured object
  },
  "reply_to_message_id": "<uuid>"   // optional; must be in the same conversation
}
```

Response (201):

```json
{
  "data": {
    "message_id": "…",
    "whatsapp_message_id": "wamid.…",
    "conversation_id": "…",
    "contact_id": "…",
    "contact_created": true
  }
}
```

Domain error codes beyond the table above: `whatsapp_not_configured`
(400), `meta_error` (502 — the request reached Meta and it rejected the
send), `template_malformed` (500).

### `GET /api/v1/contacts`

List contacts, newest first. Scope: `contacts:read`. Paginated (see
[Pagination](#pagination)). Optional filters: `?search=` (matches name
or phone) and `?tag=<tagId>`.

```json
{
  "data": [
    {
      "id": "…", "phone": "+14155550123", "name": "Jane Doe",
      "email": null, "company": "Acme", "avatar_url": null,
      "tags": [{ "id": "…", "name": "vip", "color": "#3b82f6" }],
      "created_at": "…", "updated_at": "…"
    }
  ],
  "meta": { "next_cursor": "…" }
}
```

### `POST /api/v1/contacts`

Create a contact. Scope: `contacts:write`. `phone` (E.164) is required;
`name`, `email`, `company`, and `tags` (an array of tag names, created
if missing) are optional. **Find-or-create by phone:** an existing
match returns `200` with the existing contact; a new contact returns
`201`. The response body is the serialized contact (same shape as the
list rows above).

### `GET` / `PATCH /api/v1/contacts/{id}`

Read or update one contact. Scopes: `contacts:read` / `contacts:write`.
`PATCH` updates only the fields you send (`name`, `email`, `company`);
pass `tags` (an array of tag names) to replace the contact's tags. A
contact in another account returns `404`.

### `GET /api/v1/conversations`

List conversations, newest first. Scope: `conversations:read`.
Paginated. Optional filters: `?status=` (`open` / `pending` / `closed`)
and `?contact_id=`. Each conversation embeds its contact + tags.

### `GET /api/v1/conversations/{id}`

Read one conversation. Scope: `conversations:read`. `404` if it belongs
to another account.

### `GET /api/v1/conversations/{id}/messages`

List a conversation's messages, newest first. Scope: `messages:read`.
Paginated. Each message includes its `direction` (`inbound` /
`outbound`), `status` (delivery state), `whatsapp_message_id`, and
`content_*`. The conversation is verified to belong to your account
first (`404` otherwise).

### `POST /api/v1/broadcasts`

Launch a template broadcast to a list of recipients. Scope:
`broadcasts:send`. The broadcast + its recipient rows are persisted
immediately and the sends fan out in the background, so the call
returns fast — poll `GET /api/v1/broadcasts/{id}` for progress.

```bash
curl -X POST https://your-crm.example.com/api/v1/broadcasts \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "July promo",
        "template_name": "promo_july",
        "template_language": "en_US",
        "recipients": [
          { "to": "+14155550123", "params": ["Jane"] },
          { "to": "+14155550124" }
        ]
      }'
```

Recipients are capped at **1000 per request** — split larger sends.
Invalid phone numbers are dropped and counted as `rejected`. Response
(202):

```json
{
  "data": {
    "broadcast_id": "…",
    "status": "sending",
    "total_recipients": 2,
    "accepted": 2,
    "rejected": 0
  }
}
```

### `GET /api/v1/broadcasts/{id}`

Broadcast status + counts. Scope: `broadcasts:send`. `status` moves
`sending` → `sent`; `delivered_count` / `read_count` keep climbing as
Meta delivery webhooks arrive. `404` for another account's broadcast.

## Pagination

Every list endpoint pages the same way. Request a page size with
`?limit=` (default 50, max 100) and read the next page with the opaque
`meta.next_cursor` from the previous response:

```
GET /api/v1/contacts?limit=50
→ { "data": [ … ], "meta": { "next_cursor": "eyJ…" } }

GET /api/v1/contacts?limit=50&cursor=eyJ…
→ { "data": [ … ], "meta": { "next_cursor": null } }   // last page
```

Cursors are keyset-based (stable under concurrent inserts). Pass the
cursor back verbatim — don't parse it. `next_cursor: null` means the
last page.

## Webhooks

Rather than polling, register an endpoint and wacrm will POST to it when
things happen in your account. **Migration required:** apply
`supabase/migrations/028_webhook_endpoints.sql`.

### Events

| Event                    | Fires when                                        |
| ------------------------ | ------------------------------------------------- |
| `message.received`       | An inbound message arrives from a contact         |
| `message.status_updated` | A message you sent changed delivery status        |
| `conversation.created`   | A new conversation is opened for a contact        |

### Managing endpoints

All under scope `webhooks:manage`.

- `POST /api/v1/webhooks` — register `{ "url": "https://…", "events": ["message.received"] }`. `url` must be `https://`. **The response includes `secret` exactly once** — store it to verify signatures; wacrm keeps only an encrypted copy.
- `GET /api/v1/webhooks` — list your endpoints (never returns the secret).
- `GET /api/v1/webhooks/{id}` — read one.
- `PATCH /api/v1/webhooks/{id}` — update `url`, `events`, or `is_active` (re-enabling clears the failure counter).
- `DELETE /api/v1/webhooks/{id}` — remove one.

```bash
curl -X POST https://your-crm.example.com/api/v1/webhooks \
  -H "Authorization: Bearer wacrm_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{ "url": "https://example.com/hooks/wacrm", "events": ["message.received"] }'
# → 201 { "data": { "id": "…", "url": "…", "events": [...], "secret": "whsec_…" } }
```

### Delivery payload

Every delivery is a POST with this envelope; `id` is a unique per-
delivery uuid you can dedupe on, and `data` varies by `event`:

```json
{
  "id": "8f3c…",
  "event": "message.received",
  "occurred_at": "2026-07-01T12:00:00.000Z",
  "account_id": "…",
  "data": { /* per-event, see below */ }
}
```

`data` by event:

```jsonc
// message.received
{ "conversation_id": "…", "contact_id": "…", "whatsapp_message_id": "wamid.…", "content_type": "text", "text": "Hi 👋" }
// conversation.created
{ "conversation_id": "…", "contact_id": "…" }
// message.status_updated
{ "whatsapp_message_id": "wamid.…", "conversation_id": "…", "status": "delivered" }
```

Headers: `X-Wacrm-Event`, `X-Wacrm-Webhook-Id`, and `X-Wacrm-Signature`.

### Verifying the signature

`X-Wacrm-Signature: t=<unix_seconds>,v1=<hex>` where `v1 =
HMAC-SHA256(secret, "${t}.${rawBody}")`. Recompute it over the **raw
request body** and compare in constant time; reject if `t` is more than
a few minutes old (replay protection).

```js
const [, t, v1] = header.match(/t=(\d+),v1=([0-9a-f]+)/);
const expected = crypto.createHmac('sha256', secret)
  .update(`${t}.${rawBody}`).digest('hex');
const ok = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
```

### Delivery semantics

Delivery is **best-effort**: a single attempt per event with a short
timeout, and **redirects are not followed**. `message.status_updated`
covers messages wacrm stores (inbox + API sends), not broadcast-only
sends, and — because providers re-send and re-order status callbacks —
the same status may arrive more than once or out of order; **dedupe on
`id` and don't assume ordering**. Each consecutive failure increments
`failure_count`; after enough consecutive failures the endpoint is
auto-disabled (`is_active: false`) — re-enable it with `PATCH` (which
resets the counter). Durable retry-with-backoff (a delivery queue) is a
future enhancement; today, treat missed deliveries as possible and
reconcile with the read endpoints when it matters.

**Target restrictions (SSRF).** The `url` must be `https://` and must
resolve to a public address — requests to `localhost`, private/RFC1918
ranges, link-local (incl. cloud metadata `169.254.169.254`), and similar
internal targets are refused at delivery time.

## Recover Agent integration

Per brand, Recover Agent stores:

| Setting    | Value                                              |
| ---------- | -------------------------------------------------- |
| `base_url` | `https://wa.recoveragent.ai` (or your deploy URL)  |
| Token      | A brand-scoped API key (`wacrm_live_…`)            |

**Auth model:** one bearer token per **brand** (wacrm `account`), not
per Recover Agent company. Mint keys in **Settings → API keys** with
scopes `messages:send` and `templates:read`. Revoke and re-create to
rotate; only the hash is stored server-side.

**Abandoned checkout mirror:** when enabled in Recover Agent, each
accepted ABC webhook is POSTed to
`/api/v1/events/abandoned-checkout` with the same bearer token.
Recover Agent logs mirror attempts as `abc-whatsapp-mirror`.

**WABA mapping:** API key → `account_id` → `whatsapp_config` row
(`phone_number_id`, `waba_id`, encrypted `access_token`). Recover
Agent's `metadata.company_id` is echoed back for your correlation
only.

**Delivery status webhooks back to Recover Agent:** not implemented in
v1. Delivery/read receipts update inside wacrm's inbox via Meta
webhooks. Use wacrm's outbound [webhooks](#webhooks) for automations on
this side.

## Roadmap

The public API now covers messaging, contacts, conversations,
broadcasts, and outbound webhooks — the full scope of
[#245](https://github.com/ArnasDon/wacrm/issues/245). Future ideas
(deals/pipelines, flows, a delivery queue for webhooks, and
Recover Agent delivery-status callbacks) are not yet scheduled.
