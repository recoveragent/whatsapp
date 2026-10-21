# WooCommerce dashboard connection handoff

The dashboard and WhatsApp app both need deployment for automatic connection.

1. Deploy the WhatsApp app with the WooCommerce SSO receiver.
2. Deploy `supabase/functions/sso-consume` in the Dashboard repository, including
   its `_shared/woocommerce-sso.ts` dependency. A dashboard frontend deployment
   alone does not deploy this Edge Function.
3. For a company with `companies.ecommerce_platform = woocommerce` and an active
   `platform_integrations` row, open WhatsApp CRM from the dashboard as a workspace
   owner/admin. Use the same existing WhatsApp workspace as before.
4. Confirm Settings shows WooCommerce connected; verify a new order reaches the
   inbox and starts the intended WooCommerce flow.

The one-time ticket's server response includes `woocommerce_connection` with
`store_url`, `consumer_key` (dashboard `api_key`), and `consumer_secret` (dashboard
`api_secret`). Never place credentials in redirect URLs, browser storage or logs.
The response is non-cacheable; WhatsApp encrypts credentials using the existing
connection storage and registers its own order/customer webhooks. REST keys need
Read/Write access for registration. Repeated sign-ins preserve the signing secret.

The authenticated WhatsApp profile (or authorized super-admin acting brand)
determines the destination. Import requires admin access. A company ID from the
payload never selects a destination account. The import can replace an
unconnected legacy Shopify default, but rejects a Shopify config, a store claimed
by another brand, or replacement of a different WooCommerce store. Lookup errors
fail closed. Store verification and webhook setup must succeed before changing
the platform or saving the connection. Existing flows are not converted.

Missing/inactive dashboard integrations do not import credentials. Incomplete
active integrations return an error. Existing Shopify and voice SSO contracts
remain supported. No changes to authentication ticket secrets or database schema
are required.

Automated tests use synthetic stores and credentials. A real store import and
webhook delivery still require a post-deployment smoke test.
