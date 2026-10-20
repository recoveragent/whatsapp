-- Conversation flow-run lookups were scanning thousands of rows on each
-- inbox/automation request. Cover both existence and status-count queries.
set lock_timeout = '5s';
set statement_timeout = '30s';

create index if not exists idx_flow_runs_conversation_status
  on public.flow_runs (conversation_id, status) include (id);
