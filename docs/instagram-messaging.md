# Instagram messaging setup

This integration uses the Instagram API with Unified Login and the existing Meta app. Each connected professional account belongs to one CRM workspace. The initial inbox supports text messages; attachments are shown as placeholders. It receives new events after connection and does not import past conversations.

1. Apply `20261119170052_instagram_messaging.sql` with the application release. Do not configure the webhook until the endpoint is deployed.
2. In the Meta app, add the Instagram use case and create an Instagram-compatible Facebook Login for Business configuration. Request only `instagram_basic` and `instagram_manage_messages` for messaging. Record its configuration ID as `META_INSTAGRAM_CONFIG_ID` on the server.
3. Register `https://YOUR_DOMAIN/api/instagram/callback` as the exact redirect URL. Set `NEXT_PUBLIC_SITE_URL` to that HTTPS origin. Configure `META_APP_ID` (or `NEXT_PUBLIC_META_APP_ID`), `META_APP_SECRET`, and the existing `ENCRYPTION_KEY` on the server.
4. Generate a random `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` and configure `https://YOUR_DOMAIN/api/instagram/webhook` and the same verification token in the Instagram Unified Login webhook settings. Subscribe to `messages`.
5. In Settings > Instagram, connect a professional account. Select exactly one Instagram account in the Meta dialog. The app subscribes that account to message webhooks.
6. Send a test DM from another account, verify its appearance in Inbox > Instagram, and reply within 24 hours. Repeat a webhook notification to verify it does not create a duplicate. Meta App Review and Advanced Access are needed before customers without app roles can connect.

The migration keeps encrypted tokens in a service-role-only table. Inbox rows use workspace membership policies. The 24-hour restriction is conservative; other Meta messaging windows are not implemented. A failed or ambiguous send must be checked in Instagram before retrying.

Message webhooks are the primary delivery path. As a fallback (Meta may not deliver `messages` webhooks while `instagram_manage_messages` has only Standard Access), the scheduled-jobs cron also reads each connected account's recently updated conversations through the Graph API every minute (`src/lib/instagram/sync.ts`) and stores new messages through the same idempotent `instagram_record_message` function. It never imports messages older than 24 hours or older than the connection.

## Comment to DM

Rules in Settings > Instagram send one private reply to a matching comment. Apply `20261124030000_instagram_comment_to_dm.sql` before deploying. The login configuration must also request `instagram_manage_comments`, and existing accounts must reconnect. Rules start off and ignore comments made before they were switched on. A reply is reserved before sending and is never retried automatically, so a person gets at most one DM per post. Comment webhooks are used when delivered; otherwise the minute scheduler reads the newest 50 comments on each chosen post, or on the 10 most recent posts, and sends up to 20 DMs per account per run.

Rules can block words, skip comments that tag someone else, match whole words or anywhere in the comment, and post one random public reply after the DM is confirmed, up to a limit per post. Editing a rule that is on restarts its clock, so earlier comments are never reached.

Sends stay under 600 per account per hour (Meta allows 750). Comment to DM pauses for 24 hours on a policy block, an invalid login or five failures in a row, and for one hour on a rate limit. A public reply rate limit or five failed public replies pauses public replies only. Comments made during a full pause are not answered.

## Login renewal

Instagram logins from the current configuration last 60 days. Once a day the scheduler records each expiry and, within 20 days of it, exchanges the token. The new token is kept only if Meta reports it as valid, longer lasting and holding the same permissions; otherwise Settings > Instagram asks for a reconnect. Renewal has not been tested against Meta yet.
