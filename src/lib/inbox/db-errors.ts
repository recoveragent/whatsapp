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

  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You do not have permission to perform this action.';
  }

  return message || 'Database error';
}
