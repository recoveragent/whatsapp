import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ persist: vi.fn(), admin: vi.fn(), org: vi.fn(), role: 'owner', accessible: true, signedIn: true }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: h.admin }));
vi.mock('@/lib/auth/organization', () => ({ fetchOrganizationMembership: h.org }));
vi.mock('./persist-config', () => ({ persistWooCommerceConfig: h.persist }));
import { importRecoverAgentWooCommerceConnection } from './recover-agent-import';

const connection = { store_url: 'https://brand.example', consumer_key: 'ck_test', consumer_secret: 'cs_test' };
function run() {
  const sessionClient = {
    auth: { getUser: async () => ({ data: { user: h.signedIn ? { id: 'user-1' } : null }, error: null }) },
    from: (table: string) => {
      const chain = { select: () => chain, eq: () => chain,
        maybeSingle: async () => ({ data: table === 'profiles'
          ? { account_id: 'brand-1', account_role: h.role }
          : h.accessible ? { id: 'brand-1' } : null, error: null }),
      };
      return chain;
    },
  } as never;
  return importRecoverAgentWooCommerceConnection({ sessionClient, connection, webhookCallbackUrl: 'https://wa.recoveragent.ai/api/woocommerce/webhook' });
}
beforeEach(() => {
  vi.clearAllMocks();
  h.org.mockResolvedValue(null);
  h.admin.mockReturnValue({ marker: 'admin-client' });
  h.persist.mockResolvedValue({ ok: true });
  h.role = 'owner'; h.accessible = true; h.signedIn = true;
});
describe('WooCommerce SSO workspace authorization', () => {
  it('imports into the authenticated owner workspace', async () => {
    await run();
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'brand-1', userId: 'user-1', selectPlatformForSso: true }));
  });
  it.each(['agent', 'viewer'])('rejects %s before accessing the service role', async (role) => {
    h.role = role;
    await expect(run()).rejects.toThrow('workspace admin');
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('requires authentication', async () => {
    h.signedIn = false;
    await expect(run()).rejects.toThrow('user');
    expect(h.persist).not.toHaveBeenCalled();
  });
  it('requires RLS-visible access to the acting workspace', async () => {
    h.accessible = false;
    await expect(run()).rejects.toThrow('access');
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('uses a super admin acting brand rather than a stale profile workspace', async () => {
    h.org.mockResolvedValue({ actingAccountId: 'acting-brand' });
    await run();
    expect(h.persist).toHaveBeenCalledWith(expect.objectContaining({ accountId: 'acting-brand' }));
  });
  it('requires a super admin to select a brand', async () => {
    h.org.mockResolvedValue({ actingAccountId: null });
    await expect(run()).rejects.toThrow('Select');
    expect(h.admin).not.toHaveBeenCalled();
  });
  it('does not surface sensitive provider errors', async () => {
    h.persist.mockResolvedValue({ ok: false, error: 'cs_sensitive' });
    await expect(run()).rejects.not.toThrow('cs_sensitive');
  });
});
