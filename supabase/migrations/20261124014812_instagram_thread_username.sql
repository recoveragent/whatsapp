-- Display name for Instagram threads. Filled by the Graph API sync from
-- conversation data or the Instagram user profile; nullable because Meta may
-- not return it for every participant.
ALTER TABLE public.instagram_threads ADD COLUMN participant_username text;
