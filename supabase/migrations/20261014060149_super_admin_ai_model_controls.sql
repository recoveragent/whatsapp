-- Model/provider/credentials are controlled by the scoped super-admin API,
-- which authorizes organization ownership before using the service role.
-- RLS still limits allowed behavior updates to brand admins in their account.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.ai_configs FROM PUBLIC, anon, authenticated;
GRANT UPDATE (system_prompt, is_active, auto_reply_enabled,
  auto_reply_max_per_conversation, handoff_agent_id)
  ON TABLE public.ai_configs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_configs TO service_role;

-- Make the existing UPDATE policy explicit about preserving account ownership.
DROP POLICY IF EXISTS ai_configs_update ON public.ai_configs;
CREATE POLICY ai_configs_update ON public.ai_configs FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));
