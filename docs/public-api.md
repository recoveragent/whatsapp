# Public API (`/api/v1`)

The public API lets you drive your wacrm instance from your own
scripts and automations — send messages, manage contacts, launch
broadcasts — without going through the dashboard UI.

> **Status:** `GET /api/v1/me`, `GET /api/v1/templates`, and
> `POST /api/v1/send` ship for Recover Agent integration.
> Contacts/conversations endpoints and outbound webhooks land in
> follow-up releases — see [Roadmap](#roadmap).

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
      "category": "Utility"
    }
  ]
}
```

- `id` is the Meta template **name** — pass it as `template_id` on send.
- `params` lists variable slots in send order. Use these keys when
  sending object-style `params`, or pass a positional string array.

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

**WABA mapping:** API key → `account_id` → `whatsapp_config` row
(`phone_number_id`, `waba_id`, encrypted `access_token`). Recover
Agent's `metadata.company_id` is echoed back for your correlation
only.

**Delivery status webhooks back to Recover Agent:** not implemented in
v1. Delivery/read receipts update inside wacrm's inbox via Meta
webhooks. Outbound event webhooks remain on the roadmap.

## Roadmap

Planned endpoints, shipping one per release (tracked in
[#245](https://github.com/ArnasDon/wacrm/issues/245)):

- `POST /api/v1/messages` — alias of `/api/v1/send` (optional)
- `GET/POST /api/v1/contacts`, `GET/PATCH /api/v1/contacts/{id}`
  (`contacts:read` / `contacts:write`)
- `GET /api/v1/conversations` (`conversations:read`)
- `POST /api/v1/broadcasts` (`broadcasts:send`)
- Outbound event webhooks (so automations can react to inbound
  messages)
