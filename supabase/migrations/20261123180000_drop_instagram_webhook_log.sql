-- Remove the temporary Instagram webhook diagnostics table
-- (added in 20261121010000_instagram_webhook_log.sql).
DROP TABLE IF EXISTS public.instagram_webhook_log;
