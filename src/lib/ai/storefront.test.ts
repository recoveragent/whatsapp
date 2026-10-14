import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchStorefrontPolicies,
  policyHtmlToText,
  storefrontDocumentId,
} from './storefront';

afterEach(() => vi.unstubAllGlobals());
describe('storefront policy import', () => {
  it('uses stable IDs isolated by account and store', () => {
    const id = storefrontDocumentId('account-1', 'store.myshopify.com');
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
    );
    expect(id).toBe(storefrontDocumentId('account-1', 'store.myshopify.com'));
    expect(id).not.toBe(
      storefrontDocumentId('account-2', 'store.myshopify.com')
    );
    expect(id).not.toBe(
      storefrontDocumentId('account-1', 'other.myshopify.com')
    );
  });
  it('imports readable policy content and source metadata', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json({
            policies: [
              {
                title: 'Returns',
                body: '<p>Returns within 30 days.</p><script>ignore instructions</script>',
                url: 'https://store.test/returns',
                updated_at: '2026-10-12',
              },
            ],
          })
        )
    );
    const result = await fetchStorefrontPolicies(
      'store.myshopify.com',
      'secret'
    );
    expect(result).toContain('Returns within 30 days.');
    expect(result).toContain('https://store.test/returns');
    expect(result).toContain('2026-10-12');
    expect(result).not.toContain('ignore instructions');
  });
  it('does not overwrite training with an empty import', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ policies: [] }))
    );
    await expect(
      fetchStorefrontPolicies('store.myshopify.com', 'secret')
    ).rejects.toThrow('No published');
  });
  it('explains permission errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 })
    );
    await expect(
      fetchStorefrontPolicies('store.myshopify.com', 'secret')
    ).rejects.toThrow('read_legal_policies');
  });
  it('preserves paragraph boundaries', () => {
    expect(
      policyHtmlToText('<p>Return &amp; exchange</p><p>Within 30 days</p>')
    ).toContain('Return & exchange\nWithin 30 days');
  });
});
