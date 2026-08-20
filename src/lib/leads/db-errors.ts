export function leadsMigrationMessage(error: {
  message?: string
  code?: string
}): string | null {
  const message = error.message ?? ''
  if (
    error.code === '42P01' ||
    /lead_sources|cadences|cadence_steps|cadence_enrollments|crm_tasks|lead_status|lead_language|lead_source_id/i.test(
      message,
    ) ||
    /schema cache/i.test(message)
  ) {
    return 'Lead cadences are not set up yet. Run supabase/migrations/051_lead_cadences.sql in the Supabase SQL Editor, then reload the schema cache (Settings → API → Reload schema).'
  }
  return null
}
