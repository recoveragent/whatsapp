ALTER TABLE public.accounts
  ALTER COLUMN billing_mode SET DEFAULT 'meta_direct';

UPDATE public.accounts
SET billing_mode = 'meta_direct'
WHERE billing_mode IS DISTINCT FROM 'meta_direct';
