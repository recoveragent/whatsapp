import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  account: { brand_category: 'ecommerce', ecommerce_platform: 'shopify' } as Record<string, unknown>,
  verify: vi.fn(), register: vi.fn(), ensure: vi.fn(), upsert: vi.fn(), update: vi.fn(),
  shopify: false, claimed: false, lookupError: false,
  existing: null as null | { store_url: string; webhook_secret: string },
}));
vi.mock('@/lib/ecommerce/assert-platform', () => ({
  loadAccountEcommercePlatform: async () => h.account,
  ensureAccountEcommercePlatform: h.ensure,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ encrypt: (v: string) => `encrypted:${v}`, decrypt: (v: string) => v.replace('encrypted:', '') }));
vi.mock('./admin-api', () => ({ verifyWooCommerceCredentials: h.verify, registerWooCommerceWebhooks: h.register }));
import { persistWooCommerceConfig } from './persist-config';

function database() {
  return { from: (table: string) => {
    let column = '';
    let updating = false;
    const chain = {
      select: (value: string) => { column = value; return chain; },
      eq: () => chain, neq: () => chain, is: () => chain,
      update: (patch: unknown) => { updating = true; h.update(patch); return chain; },
      upsert: h.upsert,
      maybeSingle: async () => {
        if (updating) return { data: { id: 'brand-1' }, error: null };
        if (h.lookupError) return { data: null, error: { message: 'database unavailable' } };
        if (table === 'shopify_config') return { data: h.shopify ? { account_id: 'brand-1' } : null, error: null };
        return { data: column.includes('webhook_secret') ? h.existing : h.claimed ? { account_id: 'other' } : null, error: null };
      },
    };
    return chain;
  } } as never;
}
const input = () => ({ supabase: database(), userId: 'user-1', accountId: 'brand-1',
  storeUrl: 'https://brand.example', consumerKey: 'ck_test', consumerSecret: 'cs_test',
  webhookCallbackUrl: 'https://wa.recoveragent.ai/api/woocommerce/webhook', selectPlatformForSso: true });

beforeEach(() => {
  vi.clearAllMocks();
  h.account = { brand_category: 'ecommerce', ecommerce_platform: 'shopify' };
  h.shopify = false; h.claimed = false; h.lookupError = false; h.existing = null;
  h.verify.mockResolvedValue({ store_name: 'Brand', store_url: 'https://brand.example' });
  h.register.mockResolvedValue(undefined);
  h.upsert.mockResolvedValue({ error: null });
  h.ensure.mockResolvedValue({ ok: false, status: 409, error: 'Platform mismatch' });
});

describe('WooCommerce dashboard import persistence', () => {
  it('selects WooCommerce for an unconnected legacy default and encrypts credentials', async () => {
    expect((await persistWooCommerceConfig(input())).ok).toBe(true);
    expect(h.ensure).not.toHaveBeenCalled();
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ ecommerce_platform: 'woocommerce' }));
    expect(h.upsert).toHaveBeenCalledWith(expect.objectContaining({
      account_id: 'brand-1', consumer_key: 'encrypted:ck_test', consumer_secret: 'encrypted:cs_test',
    }), { onConflict: 'account_id' });
  });
  it('keeps manual connection platform restrictions', async () => {
    expect((await persistWooCommerceConfig({ ...input(), selectPlatformForSso: false })).ok).toBe(false);
    expect(h.ensure).toHaveBeenCalled();
    expect(h.verify).not.toHaveBeenCalled();
  });
  it.each(['shopify', 'claimed', 'lookupError'] as const)('rejects %s before contacting the store', async (key) => {
    h[key] = true;
    expect((await persistWooCommerceConfig(input())).ok).toBe(false);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('rejects lead-generation workspaces', async () => {
    h.account.brand_category = 'lead_gen';
    expect((await persistWooCommerceConfig(input())).ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('rejects replacing an existing store', async () => {
    h.existing = { store_url: 'https://other.example', webhook_secret: 'encrypted:old-secret' };
    expect((await persistWooCommerceConfig(input())).ok).toBe(false);
    expect(h.register).not.toHaveBeenCalled();
  });
  it('reuses the webhook signing secret on repeat sign-ins', async () => {
    h.account.ecommerce_platform = 'woocommerce';
    h.existing = { store_url: 'https://brand.example', webhook_secret: 'encrypted:old-secret' };
    expect((await persistWooCommerceConfig(input())).ok).toBe(true);
    expect(h.register).toHaveBeenCalledWith(expect.objectContaining({ webhookSecret: 'old-secret' }));
    expect(h.update).not.toHaveBeenCalled();
  });
  it('does not select a platform or save when store verification fails', async () => {
    h.verify.mockRejectedValue(new Error('Invalid credentials'));
    expect((await persistWooCommerceConfig(input())).ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
  it('does not select a platform or save when webhook registration fails', async () => {
    h.register.mockRejectedValue(new Error('Insufficient permissions'));
    expect((await persistWooCommerceConfig(input())).ok).toBe(false);
    expect(h.update).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });
});
