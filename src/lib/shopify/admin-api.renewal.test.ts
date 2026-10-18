import { afterEach, describe, expect, it, vi } from 'vitest';
const renew = vi.hoisted(() => vi.fn());
vi.mock('./token-renewal', () => ({ renewStoredShopifyToken: renew }));
import { fetchShopInfo } from './admin-api';

afterEach(() => { vi.unstubAllGlobals(); renew.mockReset(); });

describe('Shopify request authentication recovery', () => {
  it('retries an unauthorized request once using the saved renewed token', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ errors: 'expired' }, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ shop: { name: 'Brand' } }));
    vi.stubGlobal('fetch', fetchMock);
    renew.mockResolvedValue('renewed');
    expect(await fetchShopInfo('brand.myshopify.com', 'expired')).toEqual({ name: 'Brand' });
    expect(renew).toHaveBeenCalledWith('brand.myshopify.com', 'expired');
    expect(fetchMock.mock.calls[1][1].headers['X-Shopify-Access-Token']).toBe('renewed');
  });

  it('does not loop when the renewed token is rejected', async () => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({ errors: 'invalid' }, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    renew.mockResolvedValue('renewed');
    await expect(fetchShopInfo('brand.myshopify.com', 'expired')).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(renew).toHaveBeenCalledOnce();
  });

  it('verifies the exact handoff token without silently substituting a saved token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ errors: 'invalid' }, { status: 401 })));
    await expect(fetchShopInfo('brand.myshopify.com', 'expired', false)).rejects.toMatchObject({ status: 401 });
    expect(renew).not.toHaveBeenCalled();
  });
});
