-- Retain inbox history while removing the stored credential on disconnect.
ALTER TABLE public.instagram_connections ALTER COLUMN access_token DROP NOT NULL;
ALTER TABLE public.instagram_connections DROP CONSTRAINT instagram_connections_instagram_id_key;
ALTER TABLE public.instagram_connections ADD CONSTRAINT instagram_connections_account_instagram_key UNIQUE (account_id, instagram_id);
CREATE UNIQUE INDEX instagram_connections_active_instagram_idx ON public.instagram_connections (instagram_id) WHERE access_token IS NOT NULL;
