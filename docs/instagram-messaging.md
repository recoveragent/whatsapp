# Instagram messaging setup

This integration uses the Instagram API with Unified Login and the existing Meta app. Each connected professional account belongs to one CRM workspace. The initial inbox supports text messages; attachments are shown as placeholders. It receives new events after connection and does not import past conversations.

1. Apply `20261119170052_instagram_messaging.sql` with the application release. Do not configure the webhook until the endpoint is deployed.
2. In the Meta app, add the Instagram use case and create an Instagram-compatible Facebook Login for Business configuration. Request only `instagram_basic` and `instagram_manage_messages` for messaging. Record its configuration ID as `META_INSTAGRAM_CONFIG_ID` on the server.
3. Register `https://YOUR_DOMAIN/api/instagram/callback` as the exact redirect URL. Set `NEXT_PUBLIC_SITE_URL` to that HTTPS origin. Configure `META_APP_ID` (or `NEXT_PUBLIC_META_APP_ID`), `META_APP_SECRET`, and the existing `ENCRYPTION_KEY` on the server.
4. Generate a random `INSTAGRAM_WEBHOOK_VERIFY_TOKEN` and configure `https://YOUR_DOMAIN/api/instagram/webhook` and the same verification token in the Instagram Unified Login webhook settings. Subscribe to `messages`.
5. In Settings > Instagram, connect a professional account. Select exactly one Instagram account in the Meta dialog. The app subscribes that account to message webhooks.
6. Send a test DM from another account, verify its appearance in Inbox > Instagram, and reply within 24 hours. Repeat a webhook notification to verify it does not create a duplicate. Meta App Review and Advanced Access are needed before customers without app roles can connect.

The migration keeps encrypted tokens in a service-role-only table. Inbox rows use workspace membership policies. The 24-hour restriction is conservative; other Meta messaging windows are not implemented. A failed or ambiguous send must be checked in Instagram before retrying.
