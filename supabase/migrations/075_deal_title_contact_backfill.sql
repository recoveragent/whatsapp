-- Replace deal titles that match a pipeline stage name with the linked contact name.
UPDATE deals d
SET title = COALESCE(NULLIF(TRIM(c.name), ''), c.phone, d.title)
FROM contacts c
WHERE d.contact_id = c.id
  AND EXISTS (
    SELECT 1
    FROM pipeline_stages ps
    WHERE ps.pipeline_id = d.pipeline_id
      AND lower(trim(ps.name)) = lower(trim(d.title))
  );
