# Single WhatsApp account

Each brand uses its original account and one WhatsApp number. There is no
channel selector, secondary-number setup, sender picker, or selection gate.
Team membership, presence, Shopify setup and all CRM data use that account.

Connect the number through Settings > WhatsApp. When it is configured, the
connection controls are hidden. Disconnect before connecting a replacement.
Disconnect clears credentials but retains the configuration ID and all history.
Reconnecting updates that same row; sending uses the account's single sender,
including for older conversations whose sender reference is null.

## Deployment

Deploy the matching app build together with
supabase/migrations/20261010063043_single_whatsapp_account.sql after migration 106.
Do not reapply 106 after the single-account migration.

The migration removes channel allocation, conversation reattachment and
selection-based RLS. Account membership and cross-account reference checks
remain enforced. Existing secondary tenants and their history remain archived
in place; their WhatsApp credentials are cleared and their connections are
disabled. They are not merged into the original account. Selection records and
pending Shopify imports are retained for ops recovery with client access revoked.
Historical parent/name columns remain solely to identify those archives.

If the original account has no credentials (as with Recover Agent Primary),
connect the intended number again after deployment. This change does not recover
an OAuth token from a previously rolled-back signup.

## Verification

Run the channel-isolation integration test, which exercises the transition from
106 to the single-account migration against PostgreSQL, including duplicate old
threads, archived secondary history, shared presence, and repeatability.
Also run the account, persistence, messaging and webhook regression suites.
