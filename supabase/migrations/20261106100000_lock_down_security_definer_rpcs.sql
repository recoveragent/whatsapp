-- ============================================================
-- Remove EXECUTE on SECURITY DEFINER functions from roles that have no
-- reason to call them.
--
-- Everything in `public` is reachable at /rest/v1/rpc/<name>, and the
-- anon key ships in the browser. SECURITY DEFINER functions run as their
-- owner and bypass RLS, so EXECUTE is the only gate on those without a
-- caller check of their own, such as the wallet functions.
--
-- `REVOKE ... FROM PUBLIC` was not enough in earlier migrations: Supabase's
-- default privileges grant EXECUTE on each new function directly to anon,
-- authenticated and service_role. Each role has to be named here. Those
-- default privileges are unchanged, so a new function still needs its own
-- REVOKE, as in claim_website_widget_reply.
--
-- What keeps working without a grant:
--   * Triggers: EXECUTE is checked when a trigger is created, not when it
--     fires, so signup and wallet bootstrap do not depend on these grants.
--   * Nested calls: a SECURITY DEFINER function calls others as its owner.
--
-- Grants only. No function body changes, and safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Server-only. Called through the service-role client, or not called
--    by the app at all (kept for operators). None of these check the
--    caller, so wallets come first.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.credit_wallet_for_recharge(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.credit_wallet_for_recharge(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.debit_wallet_for_message(uuid, public.message_pricing_category_enum, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.debit_wallet_for_message(uuid, public.message_pricing_category_enum, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.ensure_account_wallet(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_account_wallet(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.claim_ai_reply_slot(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ai_reply_slot(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.record_webhook_failure(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_webhook_failure(uuid, integer) TO service_role;

REVOKE ALL ON FUNCTION public.increment_contact_lead_duplicate_count(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.increment_contact_lead_duplicate_count(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.recompute_broadcast_counts(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_broadcast_counts(uuid) TO service_role;

REVOKE ALL ON FUNCTION public._bcast_bump(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._bcast_bump(uuid, text, integer) TO service_role;

REVOKE ALL ON FUNCTION public.merge_duplicate_contacts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_contacts() TO service_role;

REVOKE ALL ON FUNCTION public.merge_duplicate_conversations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.merge_duplicate_conversations() TO service_role;

-- ------------------------------------------------------------
-- 2. Trigger-only. Nobody calls these directly.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.broadcast_recipient_aggregate_trigger() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.enforce_account_references() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.notify_conversation_assigned() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.trg_accounts_ensure_wallet() FROM PUBLIC, anon, authenticated, service_role;

-- ------------------------------------------------------------
-- 3. Signed-in only. Called through the session client, by a user with a
--    JWT. service_role is left as it is.
-- ------------------------------------------------------------

REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_member_role(uuid, public.account_role_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_member_role(uuid, public.account_role_enum) TO authenticated;

REVOKE ALL ON FUNCTION public.remove_account_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_account_member(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.transfer_account_ownership(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_account_ownership(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.touch_presence(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_presence(text) TO authenticated;

REVOKE ALL ON FUNCTION public.contacts_by_last_message_activity(text[], timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contacts_by_last_message_activity(text[], timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.get_super_admin_acting_account_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_super_admin_acting_account_id() TO authenticated;

REVOKE ALL ON FUNCTION public.set_super_admin_acting_brand(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_super_admin_acting_brand(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_super_admin(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_super_admin(text) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_brand_admin_invite(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_brand_admin_invite(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resend_brand_admin_invite(uuid, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resend_brand_admin_invite(uuid, text, text, timestamptz) TO authenticated;

-- All three overloads exist on live, and /api/admin/brands falls back from
-- the six-argument form to the five-argument one.
REVOKE ALL ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz, public.brand_category_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz, public.brand_category_enum) TO authenticated;

REVOKE ALL ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz, public.brand_category_enum, public.ecommerce_platform_enum) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_brand_with_admin_invite(text, text, text, timestamptz, public.brand_category_enum, public.ecommerce_platform_enum) TO authenticated;

-- ------------------------------------------------------------
-- 4. These keep anon on purpose. The security advisor will keep flagging
--    all four.
-- ------------------------------------------------------------

-- /join/<token> shows the invite before the visitor has signed in, so
-- /api/invitations/[token]/peek runs as anon. It needs the hash of a
-- 256-bit token and returns only the brand name, role and expiry.
REVOKE ALL ON FUNCTION public.peek_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.peek_invitation(text) TO anon, authenticated, service_role;

-- RLS helpers. Most policies that call them are declared without `TO`, so
-- they apply to anon too, and anon can SELECT most public tables. Postgres
-- checks EXECUTE when it starts the query, so without this grant a signed-
-- out read would fail with "permission denied for function" instead of
-- returning no rows. With no JWT auth.uid() is NULL, so these return only
-- false or NULL. Revoke anon once those policies are `TO authenticated`.
REVOKE ALL ON FUNCTION public.is_account_member(uuid, public.account_role_enum) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_account_member(uuid, public.account_role_enum) TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_org_super_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_super_admin() TO anon, authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_organization_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO anon, authenticated, service_role;
