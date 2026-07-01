/**
 * Normalize a shop domain to `store.myshopify.com`.
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutProtocol = trimmed.replace(/^https?:\/\//, '');
  const host = withoutProtocol.split('/')[0]?.replace(/\.$/, '');
  if (!host) return null;

  if (host.endsWith('.myshopify.com')) {
    return host;
  }

  if (/^[a-z0-9][a-z0-9-]*$/.test(host)) {
    return `${host}.myshopify.com`;
  }

  return null;
}
