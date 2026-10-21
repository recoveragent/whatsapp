import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  user: true,
  member: true,
  result: { data: { id: 'brand-1', ecommerce_platform: 'woocommerce' }, error: null } as { data: unknown; error: unknown },
  update: vi.fn(),
  eq: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: h.user ? { id: 'user-1' } : null } }) },
    from: (table: string) => {
      const chain = {
        select: () => chain,
        update: (patch: unknown) => { h.update(patch); return chain; },
        eq: (...args: unknown[]) => { h.eq(...args); return chain; },
        maybeSingle: async () => table === 'organization_members'
          ? { data: h.member ? { organization_id: 'org-1' } : null }
          : h.result,
      };
      return chain;
    },
  }),
}));

import { PATCH } from './route';
const patch = (body: unknown) => PATCH(new Request('http://localhost/api/admin/brands/brand-1', {
  method: 'PATCH', body: JSON.stringify(body),
}), { params: Promise.resolve({ id: 'brand-1' }) });

beforeEach(() => {
  vi.clearAllMocks();
  h.user = true;
  h.member = true;
  h.result = { data: { id: 'brand-1', ecommerce_platform: 'woocommerce' }, error: null };
});

describe('existing brand platform updates', () => {
  it('saves and returns the platform within the super admin organization', async () => {
    const response = await patch({ ecommerce_platform: 'woocommerce' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ brand: { ecommerce_platform: 'woocommerce' } });
    expect(h.update).toHaveBeenCalledWith(expect.objectContaining({ ecommerce_platform: 'woocommerce' }));
    expect(h.eq).toHaveBeenCalledWith('id', 'brand-1');
    expect(h.eq).toHaveBeenCalledWith('organization_id', 'org-1');
    expect(h.eq).toHaveBeenCalledWith('brand_category', 'ecommerce');
  });
  it('rejects invalid platforms without writing', async () => {
    expect((await patch({ ecommerce_platform: 'other' })).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('rejects a conflicting category', async () => {
    expect((await patch({ ecommerce_platform: 'woocommerce', category: 'lead_gen' })).status).toBe(400);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('denies users without super admin membership', async () => {
    h.member = false;
    expect((await patch({ ecommerce_platform: 'woocommerce' })).status).toBe(403);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('returns 404 for foreign or non-ecommerce brands', async () => {
    h.result.data = null;
    expect((await patch({ ecommerce_platform: 'woocommerce' })).status).toBe(404);
  });
  it('preserves category-only updates', async () => {
    expect((await patch({ category: 'ecommerce' })).status).toBe(200);
    expect(h.eq).not.toHaveBeenCalledWith('brand_category', expect.anything());
  });
});
