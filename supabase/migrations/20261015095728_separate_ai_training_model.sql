-- Existing chat models/keys remain unchanged. NULL means use the chat model.
ALTER TABLE public.ai_configs ADD COLUMN training_model text
  CHECK (training_model IS NULL OR (length(trim(training_model)) BETWEEN 1 AND 200));
COMMENT ON COLUMN public.ai_configs.training_model IS
  'Optional same-provider model for website FAQ generation/retraining; super-admin managed.';
-- Authenticated model writes remain column-scoped by the model-controls migration.
REVOKE UPDATE (training_model) ON public.ai_configs FROM PUBLIC, anon, authenticated;
