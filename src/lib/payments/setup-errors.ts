/** Safe, actionable errors for incomplete payment collection deployments. */
export function paymentSetupError(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { code, message } = error as { code?: string; message?: string };
  if (
    code === 'PGRST205' || code === '42P01' ||
    (/account_payment_connections|flow_payment_requests/.test(message ?? '') &&
      /schema cache|does not exist/i.test(message ?? ''))
  ) {
    return 'Payment collection database setup is incomplete. Apply migration 20261018113952_flow_collect_payment.sql in Supabase, then reload this page.';
  }
  return null;
}
