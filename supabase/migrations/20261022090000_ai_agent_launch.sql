-- AI agent launch readiness.
--
-- 1. Knowledge search matched ANY question only when EVERY word of it
--    appeared in one chunk (`plainto_tsquery` ANDs its terms, and the
--    'simple' config keeps "what"/"is"/"your"). "What is your return
--    policy?" therefore missed the imported return policy, the prompt
--    had no knowledge, and the agent handed off. Terms are now ORed and
--    ranked, so a chunk matching more of the question ranks higher. The
--    caller strips filler words before calling (src/lib/ai/knowledge-query.ts).
CREATE OR REPLACE FUNCTION public.match_ai_knowledge_fts(
  p_account_id  uuid,
  p_query       text,
  p_match_count integer
)
RETURNS TABLE (id uuid, content text, rank real) AS $$
  WITH q AS (
    SELECT NULLIF(
      replace(plainto_tsquery('simple', p_query)::text, ' & ', ' | '),
      ''
    )::tsquery AS tsq
  )
  SELECT c.id,
         c.content,
         ts_rank(c.fts, q.tsq) AS rank
  FROM ai_knowledge_chunks c, q
  WHERE c.account_id = p_account_id
    AND q.tsq IS NOT NULL
    AND c.fts @@ q.tsq
  ORDER BY rank DESC
  LIMIT GREATEST(p_match_count, 0);
$$ LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public;

REVOKE ALL ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.match_ai_knowledge_fts(uuid, text, integer) TO authenticated, service_role;

-- 2. What the customer is told when the agent hands the chat to a human.
--    NULL uses the built-in default (src/lib/ai/defaults.ts). Brand admins
--    edit it alongside the other behaviour fields.
ALTER TABLE public.ai_configs
  ADD COLUMN IF NOT EXISTS handoff_message text
  CHECK (handoff_message IS NULL OR char_length(handoff_message) <= 1000);
GRANT UPDATE (handoff_message) ON TABLE public.ai_configs TO authenticated;

-- 3. Flows can hand a conversation to the AI agent with a goal for that
--    chat ("help them finish checkout"). The goal is read by every
--    auto-reply on the thread until a human takes over or the agent hands off.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS ai_flow_goal text
  CHECK (ai_flow_goal IS NULL OR char_length(ai_flow_goal) <= 2000);

ALTER TABLE public.flow_nodes DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;
ALTER TABLE public.flow_nodes ADD CONSTRAINT flow_nodes_node_type_check CHECK (node_type IN (
  'start','send_buttons','send_list','send_message','send_media','send_product',
  'send_template','collect_input','send_address','send_flow','condition','switch',
  'set_tag','handoff','wait','send_webhook','http_fetch','update_contact_field',
  'assign_conversation','create_deal','close_conversation','end','collect_payment',
  'ai_agent'
));
