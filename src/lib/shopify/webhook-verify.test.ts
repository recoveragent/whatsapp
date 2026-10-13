import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  lookup: vi.fn(),
  decrypt: vi.fn(),
  configured: vi.fn(),
  secret: vi.fn(),
}));
vi.mock('@/lib/automations/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: mocks.lookup }) }),
    }),
  }),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: mocks.decrypt }));
vi.mock('./config', () => ({
  getShopifyApiSecret: mocks.secret,
  isShopifyOAuthConfigured: mocks.configured,
}));
import { verifyShopifyWebhookHmac } from './webhook-verify';

const body = '{ "id": 123, "note": "private customer data" }';
const brandSecret = 'brand-private-secret';
const envSecret = 'environment-private-secret';
const sign = (secret: string, raw = body) =>
  crypto.createHmac('sha256', secret).update(raw).digest('base64');
const context = { webhookId: 'delivery-123', topic: 'orders/create' };
let info: ReturnType<typeof vi.spyOn>;
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.lookup
    .mockReset()
    .mockResolvedValue({
      data: { api_secret: 'encrypted-secret' },
      error: null,
    });
  mocks.decrypt.mockReset().mockReturnValue(brandSecret);
  mocks.configured.mockReset().mockReturnValue(true);
  mocks.secret.mockReset().mockReturnValue(envSecret);
  info = vi.spyOn(console, 'info').mockImplementation(() => {});
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Shopify verification diagnostics', () => {
  it('accepts raw-body signatures and records brand source without sensitive values', async () => {
    const signature = sign(brandSecret);
    expect(
      await verifyShopifyWebhookHmac(
        body,
        signature,
        'example.myshopify.com',
        context
      )
    ).toBe(true);
    expect(info).toHaveBeenCalledWith(
      '[shopify webhook] verification',
      expect.objectContaining({
        webhook_id: 'delivery-123',
        brand_credentials: 'ready',
        matched_source: 'brand',
        outcome: 'verified',
      })
    );
    const logs = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    for (const sensitive of [
      body,
      'private customer data',
      brandSecret,
      envSecret,
      signature,
      'encrypted-secret',
    ]) {
      expect(logs).not.toContain(sensitive);
    }
  });
  it('rejects a signature for reserialized JSON', async () => {
    expect(
      await verifyShopifyWebhookHmac(
        body,
        sign(brandSecret, JSON.stringify(JSON.parse(body))),
        'example.myshopify.com',
        context
      )
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'signature_mismatch' })
    );
  });
  it('retains environment fallback and identifies failed decryption', async () => {
    mocks.decrypt.mockImplementation(() => {
      throw new Error('sensitive exception');
    });
    expect(
      await verifyShopifyWebhookHmac(
        body,
        sign(envSecret),
        'example.myshopify.com',
        context
      )
    ).toBe(true);
    expect(info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        brand_credentials: 'decrypt_failed',
        matched_source: 'environment',
      })
    );
    expect(JSON.stringify(info.mock.calls)).not.toContain(
      'sensitive exception'
    );
  });
  it.each([
    [
      { data: null, error: { message: 'private database exception' } },
      'lookup_failed',
    ],
    [{ data: null, error: null }, 'missing_shop'],
    [{ data: { api_secret: null }, error: null }, 'missing_secret'],
  ])('distinguishes credential lookup outcomes', async (result, state) => {
    mocks.lookup.mockResolvedValue(result);
    expect(
      await verifyShopifyWebhookHmac(
        body,
        sign(brandSecret),
        'example.myshopify.com',
        context
      )
    ).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ brand_credentials: state })
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain(
      'private database exception'
    );
  });
  it('reports unavailable credentials and throws for the route to return 503', async () => {
    mocks.lookup.mockRejectedValue(new Error('private transport exception'));
    mocks.configured.mockReturnValue(false);
    await expect(
      verifyShopifyWebhookHmac(
        body,
        sign(brandSecret),
        'example.myshopify.com',
        context
      )
    ).rejects.toThrow('not configured');
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        brand_credentials: 'lookup_failed',
        outcome: 'unavailable',
      })
    );
  });
  it('rejects missing and malformed signatures', async () => {
    expect(
      await verifyShopifyWebhookHmac(
        body,
        null,
        'example.myshopify.com',
        context
      )
    ).toBe(false);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ outcome: 'missing_hmac' })
    );
    expect(
      await verifyShopifyWebhookHmac(
        body,
        'bad',
        'example.myshopify.com',
        context
      )
    ).toBe(false);
  });
});
