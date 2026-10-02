# WhatsApp channel workspaces

Each channel is an independent account tenant beneath its brand. The original
brand account hosts Primary; additional channels use accounts.parent_brand_id
to link their tenants back to the same brand. profiles.account_id stays on the
brand, so login, roles, invitations and team presence remain shared.

The top-level WhatsApp channel dropdown chooses the operational tenant. There
is no combined channel view. A selection is stored per user and brand and
applies to all that user's tabs; switching reloads the workspace and discards
open conversations, record links, selections and subscriptions from the old
channel. Other tabs reload when the selection changes through Realtime.

## Isolation boundary

- Server account context and browser useAuth().accountId resolve to the selected
  channel tenant. brandAccountId identifies the shared team/brand.
- Existing account-scoped inbox, contact deduplication, template, broadcast,
  pipeline, flow, automation, integration, API-key and reporting code now uses
  a distinct tenancy key for each channel. Wallets and pricing are also tenant
  scoped; a new channel does not inherit a prepaid balance.
- Restrictive RLS applies to account-scoped activity tables, including
  unfiltered browser queries, exports and Realtime. Shared profiles,
  invitations, presence and connection discovery are excluded explicitly.
- Database reference triggers reject links between different tenants, including
  service-role jobs. A broadcast cannot use another channel's contact; a
  conversation cannot use another channel's sender. Webhooks continue routing
  by the receiving phone_number_id, independent of the user's dropdown.
- Each tenant has exactly one WhatsApp configuration. No send path needs to
  choose an arbitrary default from several numbers.
- Disconnecting retains the tenant and contact/conversation history. Reconnecting
  the same named channel or number reuses that tenant and reattaches its threads.
- Channels must use different Meta WABAs to isolate Meta-side templates.
  New connections sharing a WABA are refused. Recover Agent's existing Primary
  and Support connections satisfy this prerequisite.
- Integrations must be connected within their intended channel. Existing
  brand-level integrations remain on Primary and are never copied into Support.
  A one-time SSO Shopify import arriving before channel selection is stored
  encrypted, then claimed and attached to the channel the user chooses. Existing
  stores are not silently reassigned between channel workspaces.

## Apply and activate

1. Take a database backup and pause webhook/cron ingestion for the migration
   window. Apply 105_whatsapp_default_number.sql, then
   106_whatsapp_channel_workspaces.sql using the Supabase SQL editor or the
   project's database deployment process. Migration 106 is transactional and
   repeatable. It preflights shared WABAs before moving data.
2. Deploy the application changes alongside the migration. Until migrated,
   multi-number brands are gated with an explicit database-update message;
   old single-number brands retain their existing behavior.
3. Enter Primary and Support separately. Verify that a customer who messages
   both numbers has separate contact records and message histories. Verify
   templates and integrations within each workspace. Connect/recreate Support's
   channel-specific settings, rules and sources as needed; no automatic copy runs.
4. Review channel_isolation_review as a brand admin, or in the SQL editor. It
   records legacy contact data, flows and unsent broadcasts needing explicit
   attribution. Review all brands, then resume webhook/cron ingestion.

## Existing data

Conversation IDs and message history are preserved. Conversations and templates
follow their saved whatsapp_config_id. A separate contact is created for each
additional channel's existing conversations, and direct conversation-owned
records follow that conversation and contact.

Existing shared notes, tags, custom values, deals and integrations stay on
Primary. Their original channel cannot be recovered reliably, so they are not
copied to another channel. This review is necessary for historical attribution;
the migration does not invent it.

Legacy flow runs referring to an additional channel are stopped and detached
from that conversation while preserving their audit rows. Associated pending
executions are stopped too. Legacy unsent broadcasts have no saved sender
provenance, so they are stopped and retained for explicit recreation in the
intended channel. Existing completed reports remain on Primary.

## Verification

Run the PostgreSQL/RLS tests and account-context regressions:

```text
npm run test -- src/lib/whatsapp/channel-isolation.integration.test.ts src/lib/whatsapp/channel-workspace.test.ts src/lib/auth/account.test.ts --maxWorkers=1
```

The database tests execute the actual migrations using PGlite. They verify
contact separation, preservation of messages, stopping ambiguous sends,
unfiltered RLS reads, selected-workspace writes, cross-channel references from
background jobs, new empty tenants, shared-WABA rejection, repeatability, and
history preservation/rebinding after disconnect and reconnect.
