/** Map Supabase/Postgres wallet errors to actionable messages. */
export function walletDbErrorMessage(error: { code?: string; message?: string } | null): string {
  const code = error?.code ?? '';
  const message = error?.message ?? '';

  if (
    code === '42P01' ||
    (/organization_payment_config|account_wallets|wallet_recharges/i.test(message) &&
      /does not exist|schema cache/i.test(message))
  ) {
    return 'Wallet tables are missing. Run supabase/migrations/034_wallet.sql in the Supabase SQL Editor, then reload the schema cache.';
  }

  if (code === '42501' || /row-level security/i.test(message)) {
    return 'You do not have permission to perform this action.';
  }

  return message || 'Database error';
}

export function encryptionConfigError(err: unknown): string | null {
  const message = err instanceof Error ? err.message : String(err);
  if (/invalid key length|ENCRYPTION_KEY/i.test(message)) {
    return 'Server encryption is misconfigured. Set ENCRYPTION_KEY to a 64-character hex string (32 bytes) in your deployment environment.';
  }
  return null;
}
