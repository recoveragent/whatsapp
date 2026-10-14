import { createHash } from 'node:crypto';
import { SHOPIFY_API_VERSION } from '@/lib/shopify/config';

/** Stable per account/store so retraining replaces only the managed import. */
export function storefrontDocumentId(
  accountId: string,
  shopDomain: string
): string {
  const hash = createHash('sha256')
    .update(`ai-storefront:${accountId}:${shopDomain}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function policyHtmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|h[1-6])>|<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n/g, '\n\n')
    .trim();
}

export async function fetchStorefrontPolicies(
  shopDomain: string,
  accessToken: string
): Promise<string> {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shopDomain))
    throw new Error('Invalid Shopify host');
  const response = await fetch(
    `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/policies.json`,
    {
      headers: { 'X-Shopify-Access-Token': accessToken },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!response.ok) {
    throw new Error(
      response.status === 403
        ? 'Shopify policy access was denied. Grant read_legal_policies and reconnect your store, or add policies manually in Knowledge.'
        : 'Could not import Shopify policies. Check your store connection and retry.'
    );
  }
  // Avoid unbounded response buffering from upstream content.
  if (!response.body) throw new Error('Shopify returned no policies');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000)
        throw new Error(
          'Store policies are too large; add the relevant sections manually in Knowledge.'
        );
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
  const body = JSON.parse(raw) as {
    policies?: Array<{
      title?: string;
      body?: string;
      url?: string;
      updated_at?: string;
    }>;
  };
  if (!Array.isArray(body.policies))
    throw new Error('Invalid Shopify policies response');
  const policies = body.policies.filter(
    (policy) => typeof policy.body === 'string' && policyHtmlToText(policy.body)
  );
  const content = policies
    .map((policy) =>
      [
        `## ${policy.title ?? 'Store policy'}`,
        policy.url ? `Source: ${policy.url}` : '',
        policy.updated_at ? `Policy updated: ${policy.updated_at}` : '',
        policyHtmlToText(policy.body!),
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n\n');
  if (!content)
    throw new Error(
      'No published Shopify policies found. Add your shipping and return policies in Shopify, or enter them in Knowledge.'
    );
  if (content.length > 100_000)
    throw new Error(
      'Store policies are too large; add the relevant sections manually in Knowledge.'
    );
  return `Storefront policies from ${shopDomain}. Imported ${new Date().toISOString()}.\n\n${content}`;
}
