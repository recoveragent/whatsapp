# WhatsApp production performance audit — 20 October 2026

## Outcome

There are two distinct problems: confirmed Meta-side holds on template delivery, and application/database patterns that add inbox load. Do not describe all slowness as one problem or promise that a frontend deployment will remove provider holds.

This was a read-only production investigation. No deployment, database modification, restart, message send, payment, or customer-thread selection was performed. Existing unrelated workspace changes were preserved. Source review used local HEAD `1993140`; Hostinger showed current deployment `5f0ae741`. Local findings must be checked against the deployed revision before release.

## Confirmed live delivery evidence

Production Supabase project: `hohjovkpjfbjhqenqqkt`, Mumbai (`ap-south-1`). The local application's Supabase URL matches this project. Project control-plane status was `ACTIVE_HEALTHY`; this does not establish healthy request latency.

A bounded sample of the latest 300 delivery events was grouped by account, WhatsApp phone ID and message ID. In the later sample, API acceptance times spanned **12:12:42–13:41:30 IST**:

| API status | Accepted messages in sample | With paired delivered event | Mean acceptance → delivery | Range |
| --- | ---: | ---: | ---: | --- |
| `held_for_quality_assessment` | 19 | 11 | 153.91 seconds | 150.85–156.29 seconds |
| `accepted` | 1 | 1 | 18.81 seconds | One observation |

An earlier snapshot had 15 held acceptances with mean Meta request duration **0.69 seconds**, maximum **1.03 seconds**. Its one normal acceptance took **1.59 seconds**. These snapshots differ because production traffic continued during the investigation.

**Conclusion:** Meta explicitly reported holding these sends after accepting the request. The roughly 154-second delay for paired held messages cannot be explained by the request taking that long. This does not prove every template or every brand is affected. Unpaired records are not evidence of failed delivery; delivery may still be pending or outside the bounded sample.

In the earlier 300-event snapshot, delivery callback arrival lag was **9.95 seconds mean / 407.73 seconds maximum** across 128 delivered callbacks; sent callbacks were **6.33 seconds mean / 59.41 seconds maximum** across 42 callbacks. Callback lag is provider event time → our endpoint receipt time, not the time spent processing the callback afterward. Provider timestamps have second precision. Callback lag and actual delivery latency must be displayed separately.

AWS's official WhatsApp integration documentation describes Meta template pacing and holding messages for feedback: https://docs.aws.amazon.com/end-user-messaging/latest/userguide/nx-features-whatsapp-templates-pacing.html . The stored Meta status is the direct evidence here; the exact account/template-level reason still needs verification in WhatsApp Manager.

## Live infrastructure observations

- A direct, outside-sandbox GET of the production login page completed with HTTP 200 in **264 ms**. This is a public page measurement, not an authenticated inbox benchmark.
- Supabase Auth's health endpoint, using the public application key, returned HTTP 200 in **8,189 ms** once. Follow-ups returned HTTP 200 in **429 ms** and **165 ms**. This shows an intermittent delay from this machine; it does not isolate server compute, networking, or connection reuse as the cause.
- Several connector SQL reads timed out with `Connection terminated due to connection timeout`; other queries succeeded. These timings include connector/management-path overhead and must not be treated as database statement execution times.
- One database activity snapshot showed six API-role transactions roughly **9–10 seconds** old, most idle in transaction awaiting the client. No lock-wait blocker was identified in that snapshot. This alone does not prove database saturation.
- The browser logged repeated `[PresenceHeartbeat] touch_presence failed: TypeError: Failed to fetch` around 13:36–13:37 IST. This supports intermittent request failures, not a specific root cause.
- Hostinger showed the current deployment completed. Its runtime-log panel reported **Failed to load logs**. CPU, RAM, process restarts, event-loop lag, hosting region, and request concurrency remain unverified. The panel's zero error counter was not treated as evidence of zero application errors because log loading failed.
- Approximate database statistics: 34,001 messages, 8,099 conversations, 21,883 contacts, 14,135 flow runs and 68,434 flow events. These are planner estimates, not exact counts. Table size by row count alone does not establish a need to upgrade compute.

## Database evidence and index gaps

`pg_stat_statements` reset time was **25 June 2026 14:41:11 UTC**. The following figures are historical aggregates since that reset, not current incident-window measurements:

| Query family | Calls | Mean execution |
| --- | ---: | ---: |
| Inbox conversations with nested contact/WhatsApp joins | 1,780 | 1,508.18 ms |
| Flow run IDs by conversation | 66,392 | 196.01 ms |
| Flow runs by conversation/status with exact count | 67,579 | 139.73 ms |
| Recent flow-run reconciliation scan | 56,722 | 121.95 ms |
| Presence heartbeat RPC | 171,216 | 24.99 ms |
| Contact phone-pattern lookup | 164,289 | 19.27 ms |

Realtime WAL polling was the largest cumulative query family: about 5.72 million calls at 7.80 ms mean. High cumulative time for continuous polling is not proof of current saturation. An existing conversation/status flow-run index is already installed in production; do not propose applying the local index migration again as a new fix.

Production index inspection found no covering indexes matching:

- Inbox account/status/last-message ordering: candidate `(account_id, status, last_message_at DESC)` with `last_message_at IS NOT NULL` predicate, plus account/time ordering for all-status views if justified by plans.
- Ordered message history: candidate `(conversation_id, created_at, id)`.
- Repair queries for all flow-run statuses by account/contact/start time: candidate `(account_id, contact_id, started_at DESC)`. The existing account/contact index is partial for active/waiting runs and does not cover unrestricted historical repair.
- Automation repair history by account/contact/date: candidate `(account_id, contact_id, created_at DESC)` on `automation_logs`.

These are candidates, **not applied fixes**. Capture representative RLS-enabled query plans and recent timing deltas before choosing indexes. Production index creation needs a controlled online rollout and verification; do not blindly add every advisor suggestion. Supabase's performance advisor also reports unindexed foreign keys and overlapping permissive policies; those are review leads, not proof they caused this incident.

## Application findings

### High priority: whole-history reads and rendering

`src/components/inbox/message-thread.tsx:485` fetches `messages.select('*')`, ordered oldest first, without explicit pagination. It repeats the query after a repair. Every selected thread renders its loaded history. A server row cap can also return the oldest subset rather than the latest messages on long threads.

Fix direction: fetch the latest bounded page using deterministic `(created_at, id)` ordering, reverse for display, and load older messages on demand. Preserve realtime merges, scroll position, replies to older messages, media navigation and optimistic sends. Consider virtualization after bounding the initial history. Do not introduce a silent history limit without an older-history control.

### High priority: expensive repair on normal reads

`src/components/inbox/message-thread.tsx:513` POSTs `repair-flow-prompt` after each history refresh, including focus/reconnect refreshes. `src/lib/flows/backfill-outbound-prompt.ts:660` scans recent runs and events and makes per-event backfill queries; automation repair also reads up to 90 days of logs.

The repair starts after initial history display, so it does not directly gate the first render. It can still compete with sends and normal reads, and can cause a second whole-history fetch. Keep recovery behavior, but use deduplication, a cooldown or a durable background reconciliation job. Avoid rerunning the whole scan on every focus transition.

### High priority: automation and media block inbound summary updates

`src/app/api/whatsapp/webhook/route.ts:902` awaits flow dispatch before `bump_conversation_on_inbound` at line 924. Flow actions can involve external APIs, sends and payment setup. Slow flows therefore delay the conversation summary/unread update. Flow-aware close/reopen behavior is intentional and must be preserved when separating summary updates from automation execution.

Media parsing before message insertion also verifies, downloads and uploads inbound media (`mirror-inbound-media.ts`). This can delay showing an image/video message. Persist a usable pending/proxy representation first, then mirror through durable work with bounded timeouts and observable failures.

### Medium priority: webhook batch head-of-line blocking and durability

Webhook statuses and messages are processed sequentially. A slow earlier status handler, outbound integration or message can delay the next item. The route acknowledges Meta before processing with Next.js `after()` and a configured 60-second duration. This preserves runtime lifetime better than detached promises, but it is not a durable queue: runtime termination after acknowledgment can leave processing incomplete without Meta retrying a successful acknowledgment.

Use durable ingestion and processing, preserving per-conversation ordering and idempotency. Do not simply parallelize all inbound events or increase timeouts without measuring the operations.

### Medium priority: search request amplification and stuck loading

`src/components/inbox/conversation-list.tsx:127` immediately fetches on every search change. Cleanup only marks results cancelled; it does not abort requests. The initial fetch and load-more path also lack catch/finally handling for a network exception, which can leave loading state active. Debounce input, abort superseded requests, handle failures visibly and guarantee loading cleanup. Guard load-more responses against filter/search changes.

`src/app/api/inbox/conversations/page/route.ts` first finds all matching contact IDs, then expands them into an `IN` expression. Broad matches can inflate query URLs and work. Prefer a scoped database search query/RPC after plan review. Cursor pagination uses only timestamp comparisons, so equal timestamps can skip conversations; pair timestamp with an ID tie-breaker when correcting pagination.

### Medium priority: broad realtime subscriptions

`src/hooks/use-realtime.ts:51` subscribes to all accessible message and conversation changes without a subscription filter; message events for inactive conversations still reach the client. RLS remains the access boundary, so lack of a filter alone is not evidence of a data leak. Narrow subscriptions where the schema supports it and avoid redundant subscriptions across dashboard surfaces. Messages do not have an account column in the local type, so an account filter cannot simply be copied onto that table without schema verification.

Supabase documents per-subscriber authorization and single-threaded Postgres Changes processing: https://supabase.com/docs/guides/realtime/postgres-changes . Validate actual subscription volume and delivery delay before a Broadcast migration.

### Medium priority: background tabs add work

Reminder notifications poll every 15 seconds in every mounted dashboard tab, even with the popover closed, and also reload on realtime. Presence heartbeats continue while hidden and have no in-flight guard. Multiple open dashboard tabs multiply this load; slow responses can overlap. Use visibility-aware polling, request coalescing and appropriate backoff without breaking reminder delivery or online/away semantics.

### Other reviewed latency paths

- `first-inbound.ts` uses exact message counts where it only needs to establish existence. A bounded existence lookup avoids counting all matches.
- Opening inbox calls `/api/whatsapp/connection`, which verifies the number against Meta. This runs separately from message-list loading, but adds external work per open. Bound the verification and distinguish provider/network errors from a definitively revoked number before showing reconnect advice.
- Meta fetch helpers have no explicit application-level timeout. A timeout on a send is ambiguous: Meta may already have accepted it. Never automatically resend based solely on a timeout.
- Broadcast sending is serial in `broadcast-core.ts`. This limits throughput, but live broadcast backlog/queue rates were not measured. Any concurrency increase needs provider-limit handling and duplicate protection.
- Images have no explicit lazy loading; audio elements do not set preload explicitly, while video uses metadata preload. Combined with whole-history rendering, media-heavy threads can add bandwidth and browser work.
- Media proxy/cache behavior, real user mobile performance, bundle/hydration costs, cron scheduling lag, AI response latency, payment-provider latency and host-to-Supabase network latency were reviewed only at source level or remain unmeasured. No live send or payment benchmark was run.

## Recommended order of work

1. **Delivery incident:** inspect the held templates' quality/pacing and account/portfolio state in WhatsApp Manager. Surface Meta's held status to agents. Do not retry accepted/held messages or promise immediate delivery; retries can duplicate messages and do not remove the hold. No account or template changes were made during this audit.
2. **Application changes:** bound initial message history, preserve older-history access, debounce/cancel searches and fix failure cleanup, and prevent repeated repair scans from ordinary focus/reconnect events. Add targeted regression tests for scroll/history, stale responses, realtime merges and repair recovery.
3. **Database tuning:** capture representative plans with tenant RLS, review the 1.5-second historical inbox query, and validate only the relevant compound indexes. Measure fresh deltas rather than comparing four-month aggregates after deployment.
4. **Inbound processing:** persist/update inbox state promptly and move media, external callbacks and automation work behind durable processing with per-conversation ordering and stage timings.
5. **Infrastructure:** obtain Hostinger runtime/resource access, compare app-to-Supabase latency against browser-to-Supabase latency, and inspect compute/IO/pool usage and region placement. Scale only if measurements justify it.

## Verification before claiming resolution

Measure separate p50/p95 values for conversation-list fetch, first visible thread page, send request acceptance, provider acceptance-to-delivery, callback arrival, and callback processing. Include a long media-heavy chat and concurrent agents. Verify no duplicate sends, no missed older history, no unread-count regressions, and unchanged tenant access boundaries. Keep rollbacks available and deploy a focused patch rather than unrelated workspace changes.

No code or schema fix was deployed, so this audit does **not** claim that production slowness is resolved. One privileged service-key probe was rejected by automatic approval review before execution; safer public-key health probes and the existing read-only connector were used instead.
