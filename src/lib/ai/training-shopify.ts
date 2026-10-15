import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { decrypt } from '@/lib/whatsapp/encryption';
import { policyHtmlToText } from './storefront';
import { trainingUrl } from './training-crawl';
import type { TrainingSource } from './training-types';

// New read-only surface; leave the existing REST integration version unchanged.
const TRAINING_SHOPIFY_API_VERSION = '2026-10';
export const TRAINING_SHOP_IDENTITY_QUERY = `query TrainingShopIdentity { shop { primaryDomain { url } } }`;
export const TRAINING_SHOP_POLICIES_QUERY = `query TrainingShopPolicies { shop { shopPolicies { title body url } } }`;
export const TRAINING_SHOP_PRODUCTS_QUERY = `query TrainingShopProducts {
  products(first: 12, query: "status:active", sortKey: UPDATED_AT, reverse: true) {
    nodes { title descriptionHtml onlineStoreUrl status }
  }
}`;

async function queryShop<T>(
  domain: string,
  token: string,
  query: string,
  signal: AbortSignal
): Promise<T> {
  const response = await fetch(
    `https://${domain}/admin/api/${TRAINING_SHOPIFY_API_VERSION}/graphql.json`,
    {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      signal,
      headers: {
        'X-Shopify-Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!response.ok)
    throw new Error(
      'Connected Shopify content is unavailable. Check the store connection and retry.'
    );
  if (!response.body) throw new Error('Shopify returned no content.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 1_000_000)
        throw new Error('Connected Shopify content exceeds the scan limit.');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const json = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
    data?: T;
    errors?: unknown[];
  };
  if (!json.data || json.errors?.length)
    throw new Error(
      'Shopify content access was denied or incomplete. Check read_products and read_legal_policies permissions.'
    );
  return json.data;
}

/** Only the authenticated brand's connected store can replace a blocked root scan. */
export async function connectedShopifyTrainingSources(
  db: SupabaseClient,
  accountId: string,
  rawUrl: string
) {
  const entered = trainingUrl(rawUrl);
  if (entered.pathname !== '/') return null;
  const { data: store, error } = await db
    .from('shopify_config')
    .select('shop_domain, access_token, status')
    .eq('account_id', accountId)
    .maybeSingle();
  if (error) throw error;
  if (!store || store.status !== 'connected' || !store.access_token)
    return null;
  const domain = String(store.shop_domain).toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain))
    throw new Error('Invalid connected Shopify domain.');
  let token: string;
  try {
    token = decrypt(store.access_token);
  } catch {
    throw new Error('Reconnect Shopify to refresh its access token.');
  }
  const signal = AbortSignal.timeout(15_000);
  const identity = await queryShop<{
    shop: { primaryDomain: { url: string } };
  }>(domain, token, TRAINING_SHOP_IDENTITY_QUERY, signal);
  const primary = trainingUrl(identity.shop.primaryDomain.url);
  if (
    entered.origin !== `https://${domain}` &&
    entered.origin !== primary.origin
  )
    return null;
  const sources: TrainingSource[] = [];
  const warnings = [
    'The public storefront blocked the scan. These sources were read through this brand’s authorized Shopify connection. Website FAQ/about pages were not crawled; review coverage and fill any unanswered questions.',
  ];
  const results = await Promise.allSettled([
    queryShop<{
      shop: {
        shopPolicies: Array<{ title: string; body: string; url: string }>;
      };
    }>(domain, token, TRAINING_SHOP_POLICIES_QUERY, signal),
    queryShop<{
      products: {
        nodes: Array<{
          title: string;
          descriptionHtml: string;
          onlineStoreUrl: string | null;
          status: string;
        }>;
      };
    }>(domain, token, TRAINING_SHOP_PRODUCTS_QUERY, signal),
  ]);
  const add = (title: string, html: string, raw: string) => {
    if (sources.length >= 6) return;
    let url: URL;
    try {
      url = trainingUrl(raw);
    } catch {
      return;
    }
    if (url.origin !== primary.origin && url.origin !== `https://${domain}`)
      return;
    const text = policyHtmlToText(html)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 9000);
    if (!text || sources.some((source) => source.url === url.href)) return;
    sources.push({
      id: randomUUID(),
      url: url.href,
      title: title.slice(0, 200),
      text,
      fetchedAt: new Date().toISOString(),
      retrievedVia: 'shopify',
    });
  };
  const policies = results[0];
  if (policies.status === 'fulfilled') {
    for (const policy of policies.value.shop.shopPolicies)
      add(policy.title, policy.body, policy.url);
  } else
    warnings.push(
      'Store policies could not be read. Check read_legal_policies permissions and add missing policy answers manually.'
    );
  const products = results[1];
  if (products.status === 'fulfilled') {
    for (const product of products.value.products.nodes) {
      if (product.status === 'ACTIVE' && product.onlineStoreUrl)
        add(
          product.title,
          `<h1>${product.title}</h1>\n${product.descriptionHtml}`,
          product.onlineStoreUrl
        );
    }
  } else
    warnings.push(
      'Product descriptions could not be read. Check read_products permissions.'
    );
  if (!sources.length)
    throw new Error(
      'No published policy or product content could be read from the connected store. Check Shopify permissions or add Knowledge manually.'
    );
  warnings.push(
    'Limited to six policy/product sources from the connected store; this is not a full website scan.'
  );
  return { websiteUrl: primary.href, sources, warnings };
}
