-- Structured stage history for deal timelines (received → stage moves with reasons).

CREATE TABLE IF NOT EXISTS deal_stage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('received', 'stage_move')),
  from_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  to_stage_id UUID REFERENCES pipeline_stages(id) ON DELETE SET NULL,
  from_stage_name TEXT,
  to_stage_name TEXT,
  reason TEXT,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_deal_created
  ON deal_stage_events(deal_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_deal_stage_events_account
  ON deal_stage_events(account_id);

ALTER TABLE deal_stage_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY deal_stage_events_select ON deal_stage_events
  FOR SELECT USING (is_account_member(account_id));

CREATE POLICY deal_stage_events_insert ON deal_stage_events
  FOR INSERT WITH CHECK (is_account_member(account_id, 'agent'));

-- Backfill received + stage_move rows from existing deals.notes text.
DO $$
DECLARE
  deal_rec RECORD;
  line TEXT;
  move_match TEXT[];
  move_lines TEXT[] := ARRAY[]::TEXT[];
  move_count INT;
  move_idx INT;
  initial_stage_name TEXT;
  initial_stage_id UUID;
  from_stage_id UUID;
  to_stage_id UUID;
  from_name TEXT;
  to_name TEXT;
  move_reason TEXT;
  move_ts TIMESTAMPTZ;
  span INTERVAL;
BEGIN
  FOR deal_rec IN
    SELECT d.id, d.account_id, d.pipeline_id, d.stage_id, d.notes, d.created_at, d.updated_at
    FROM deals d
  LOOP
    move_lines := ARRAY[]::TEXT[];

    IF deal_rec.notes IS NOT NULL AND btrim(deal_rec.notes) <> '' THEN
      FOREACH line IN ARRAY regexp_split_to_array(deal_rec.notes, E'\\n')
      LOOP
        line := btrim(line);
        IF line = '' THEN
          CONTINUE;
        END IF;

        move_match := regexp_match(line, '^Moved (.+) → (.+): (.+)$');
        IF move_match IS NOT NULL THEN
          move_lines := array_append(move_lines, line);
        END IF;
      END LOOP;
    END IF;

    move_count := COALESCE(array_length(move_lines, 1), 0);

    IF move_count > 0 THEN
      move_match := regexp_match(move_lines[1], '^Moved (.+) → (.+): (.+)$');
      initial_stage_name := move_match[1];
    ELSE
      SELECT ps.name INTO initial_stage_name
      FROM pipeline_stages ps
      WHERE ps.id = deal_rec.stage_id;
    END IF;

    SELECT ps.id INTO initial_stage_id
    FROM pipeline_stages ps
    WHERE ps.pipeline_id = deal_rec.pipeline_id
      AND ps.name = initial_stage_name
    LIMIT 1;

    INSERT INTO deal_stage_events (
      deal_id,
      account_id,
      event_type,
      to_stage_id,
      to_stage_name,
      created_at
    ) VALUES (
      deal_rec.id,
      deal_rec.account_id,
      'received',
      initial_stage_id,
      initial_stage_name,
      deal_rec.created_at
    );

    span := GREATEST(
      COALESCE(deal_rec.updated_at, deal_rec.created_at) - deal_rec.created_at,
      INTERVAL '0'
    );

    move_idx := 0;
    FOREACH line IN ARRAY move_lines
    LOOP
      move_idx := move_idx + 1;
      move_match := regexp_match(line, '^Moved (.+) → (.+): (.+)$');
      from_name := move_match[1];
      to_name := move_match[2];
      move_reason := move_match[3];

      SELECT ps.id INTO from_stage_id
      FROM pipeline_stages ps
      WHERE ps.pipeline_id = deal_rec.pipeline_id
        AND ps.name = from_name
      LIMIT 1;

      SELECT ps.id INTO to_stage_id
      FROM pipeline_stages ps
      WHERE ps.pipeline_id = deal_rec.pipeline_id
        AND ps.name = to_name
      LIMIT 1;

      IF span = INTERVAL '0' THEN
        move_ts := deal_rec.created_at + (move_idx * INTERVAL '1 minute');
      ELSE
        move_ts := deal_rec.created_at + (span * move_idx / (move_count + 1));
      END IF;

      INSERT INTO deal_stage_events (
        deal_id,
        account_id,
        event_type,
        from_stage_id,
        to_stage_id,
        from_stage_name,
        to_stage_name,
        reason,
        created_at
      ) VALUES (
        deal_rec.id,
        deal_rec.account_id,
        'stage_move',
        from_stage_id,
        to_stage_id,
        from_name,
        to_name,
        move_reason,
        move_ts
      );
    END LOOP;
  END LOOP;
END $$;
