CREATE TABLE public.ai_training_sets (
  account_id uuid PRIMARY KEY REFERENCES public.accounts(id) ON DELETE CASCADE,
  website_url text NOT NULL,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(sources) = 'array' AND jsonb_array_length(sources) <= 6),
  faqs jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(faqs) = 'array' AND jsonb_array_length(faqs) <= 100),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  published_revision integer,
  published_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_training_sets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_training_sets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ai_training_sets TO authenticated;
GRANT ALL ON public.ai_training_sets TO service_role;
CREATE POLICY ai_training_sets_select ON public.ai_training_sets FOR SELECT TO authenticated
  USING (public.is_account_member(account_id));
CREATE POLICY ai_training_sets_insert ON public.ai_training_sets FOR INSERT TO authenticated
  WITH CHECK (public.is_account_member(account_id, 'admin'));
CREATE POLICY ai_training_sets_update ON public.ai_training_sets FOR UPDATE TO authenticated
  USING (public.is_account_member(account_id, 'admin'))
  WITH CHECK (public.is_account_member(account_id, 'admin'));

-- Publication is one transaction: the previous live knowledge survives any failure.
-- SECURITY INVOKER retains the caller's RLS; no service-role or definer bypass.
CREATE FUNCTION public.publish_ai_training(p_account_id uuid, p_revision integer, p_unpublish boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE
  training public.ai_training_sets%ROWTYPE;
  doc_id uuid := md5('website-faq:' || p_account_id::text)::uuid;
  body text;
BEGIN
  IF NOT public.is_account_member(p_account_id, 'admin') THEN
    RAISE EXCEPTION 'Brand admin access required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO training FROM public.ai_training_sets
    WHERE account_id = p_account_id FOR UPDATE;
  IF NOT FOUND OR training.revision <> p_revision THEN
    RAISE EXCEPTION 'Training changed. Reload before publishing.' USING ERRCODE = '40001';
  END IF;
  IF p_unpublish THEN
    DELETE FROM public.ai_knowledge_chunks WHERE document_id = doc_id AND account_id = p_account_id;
    DELETE FROM public.ai_knowledge_documents WHERE id = doc_id AND account_id = p_account_id;
    UPDATE public.ai_training_sets SET published_revision = NULL, published_at = NULL WHERE account_id = p_account_id;
    RETURN doc_id;
  END IF;
  SELECT string_agg('Q: ' || (faq->>'question') || E'\nA: ' || (faq->>'answer'), E'\n\n' ORDER BY ordinal)
    INTO body FROM jsonb_array_elements(training.faqs) WITH ORDINALITY AS entries(faq, ordinal)
    WHERE faq->>'approved' = 'true' AND length(trim(faq->>'answer')) > 0;
  IF body IS NULL THEN
    RAISE EXCEPTION 'Approve at least one non-empty answer before publishing.' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.ai_knowledge_documents (id, account_id, created_by, title, content)
    VALUES (doc_id, p_account_id, auth.uid(), 'Website customer questions — merchant reviewed', body)
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, updated_at = now()
    WHERE public.ai_knowledge_documents.account_id = p_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Knowledge document belongs to another brand' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.ai_knowledge_chunks WHERE document_id = doc_id AND account_id = p_account_id;
  -- One FAQ per retrieval unit prevents an answer being split away from its question.
  INSERT INTO public.ai_knowledge_chunks (document_id, account_id, chunk_index, content)
    SELECT doc_id, p_account_id, (ordinal - 1)::integer,
      'Q: ' || (faq->>'question') || E'\nA: ' || (faq->>'answer')
    FROM jsonb_array_elements(training.faqs) WITH ORDINALITY AS entries(faq, ordinal)
    WHERE faq->>'approved' = 'true' AND length(trim(faq->>'answer')) > 0;
  UPDATE public.ai_training_sets SET published_revision = revision, published_at = now()
    WHERE account_id = p_account_id;
  RETURN doc_id;
END;
$$;
REVOKE ALL ON FUNCTION public.publish_ai_training(uuid, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publish_ai_training(uuid, integer, boolean) TO authenticated;
