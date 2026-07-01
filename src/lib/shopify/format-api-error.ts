/**
 * Shopify Admin API returns `errors` as a string, array, or nested object.
 * String(obj) becomes "[object Object]" — normalize to readable text.
 */
export function formatShopifyApiError(body: unknown, fallback: string): string {
  if (!body || typeof body !== 'object') return fallback;

  const errors = (body as { errors?: unknown; error?: unknown }).errors
    ?? (body as { error?: unknown }).error;

  if (typeof errors === 'string' && errors.trim()) return errors;
  if (Array.isArray(errors)) {
    return errors.map((e) => String(e)).join(', ');
  }
  if (errors && typeof errors === 'object') {
    return Object.entries(errors as Record<string, unknown>)
      .map(([key, value]) => {
        if (Array.isArray(value)) return `${key}: ${value.join(', ')}`;
        return `${key}: ${String(value)}`;
      })
      .join('; ');
  }

  const description = (body as { error_description?: string }).error_description;
  if (typeof description === 'string' && description.trim()) return description;

  return fallback;
}

export function isLocalWebhookUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === 'localhost' || host === '127.0.0.1';
  } catch {
    return false;
  }
}
