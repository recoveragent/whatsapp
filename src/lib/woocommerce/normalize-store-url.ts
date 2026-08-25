/** Normalize a WooCommerce store URL to `https://host` (no trailing slash). */
export function normalizeStoreUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    url = new URL(withProtocol);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.hostname.includes(' ')) return null;

  return `${url.protocol}//${url.host}`.replace(/\/$/, '');
}
