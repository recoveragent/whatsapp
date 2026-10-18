import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ admin: vi.fn() }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }));
import { requestShopifyClientToken, renewStoredShopifyToken } from './token-renewal';
import { encrypt, decrypt } from '@/lib/whatsapp/encryption';

afterEach(() => vi.unstubAllGlobals());

function database(token = 'expired', secret: string | null = encrypt('client-secret')) {
  const update = vi.fn();
  const eq = vi.fn();
  const builder = {
    select: vi.fn().mockReturnThis(), eq, maybeSingle: vi.fn().mockResolvedValue({
      data: { account_id: 'brand', access_token: encrypt(token), api_key: 'client', api_secret: secret, status: 'connected' }, error: null,
    }),
    update,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
  };
  eq.mockReturnValue(builder);
  update.mockReturnValue(builder);
  mocks.admin.mockReturnValue({ from: () => builder });
  return { update, eq };
}

describe('Shopify client credentials renewal', () => {
  it('exchanges app credentials without caching or exposing the secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ access_token: 'renewed', expires_in: 86399 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await requestShopifyClientToken('brand.myshopify.com', 'client', 'secret')).toBe('renewed');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://brand.myshopify.com/admin/oauth/access_token');
    expect(init.body.get('grant_type')).toBe('client_credentials');
    expect(init.body.get('client_secret')).toBe('secret');
    expect(init.cache).toBe('no-store');
  });

  it('does not leak error response credentials', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: 'secret-value' }, { status: 401 })));
    await expect(requestShopifyClientToken('brand.myshopify.com', 'client', 'secret')).rejects.toThrow('HTTP 401');
    await expect(requestShopifyClientToken('brand.myshopify.com', 'client', 'secret')).rejects.not.toThrow('secret-value');
  });

  it('renews once for concurrent failures and saves the token encrypted', async () => {
    const { update, eq } = database();
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ access_token: 'renewed' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await Promise.all([
      renewStoredShopifyToken('brand.myshopify.com', 'expired'),
      renewStoredShopifyToken('brand.myshopify.com', 'expired'),
    ])).toEqual(['renewed', 'renewed']);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(decrypt(update.mock.calls[0][0].access_token)).toBe('renewed');
    expect(eq).toHaveBeenCalledWith('account_id', 'brand');
    expect(eq).toHaveBeenCalledWith('status', 'connected');
  });

  it('uses a token already renewed by another request', async () => {
    const { update } = database('already-renewed');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await renewStoredShopifyToken('brand.myshopify.com', 'expired')).toBe('already-renewed');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('does not attempt client credentials renewal without saved app credentials', async () => {
    database('expired', null);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await renewStoredShopifyToken('brand.myshopify.com', 'expired')).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
