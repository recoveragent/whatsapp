/** Map Supabase/Postgres errors to user-facing inbox messages. */
export function inboxDbErrorMessage(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? '';
  const message = error?.message ?? '';

  if (
    code === '42P01' ||
    (/conversation_private_notes|shopify_orders/i.test(message) &&
      /does not exist|schema cache/i.test(message))
  ) {
    return 'Inbox tables are missing. Run supabase/migrations/030_inbox_shopify_notes.sql in Supabase SQL Editor.';
  }

  if (
    /followup_scheduled_at|followup_sent_at|inbox_followup_settings/i.test(message) &&
    /does not exist|schema cache/i.test(message)
  ) {
    return 'Follow-up feature is not set up yet. Run supabase/migrations/035_inbox_followup.sql in the Supabase SQL Editor, then reload the schema cache (Settings → API → Reload schema).';
  }

  if (
    /conversations_status_check|violates check constraint/i.test(message) &&
    /followup/i.test(message)
  ) {
    return 'Follow-up status is not enabled in the database. Run supabase/migrations/035_inbox_followup.sql in the Supabase SQL Editor.';
  }

  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You do not have permission to perform this action.';
  }

  return message || 'Database error';
}
