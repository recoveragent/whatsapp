import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductCarouselAlreadySentError } from './product-delivery-error';
import { MetaCarouselRejectedError } from '@/lib/whatsapp/carousel-errors';
const h = vi.hoisted(() => ({ send: vi.fn(), saveError: true }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendInteractiveMediaCarousel: h.send,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token' }));
vi.mock('./product-store', () => ({
  getShopifyCatalogProduct: async ({
    shopifyVariantId,
  }: {
    shopifyVariantId: string;
  }) => ({
    shopify_variant_id: Number(shopifyVariantId),
    title: 'Hoodie',
    price: '900',
    currency: 'INR',
    image_url: 'https://cdn.test/image.jpg',
    in_stock: true,
  }),
}));
import { sendShopifyProductCarousel } from './send-product-carousel';

function db() {
  return {
    from: (table: string) => {
      const result = () => ({
        data:
          table === 'shopify_config'
            ? {
                status: 'connected',
                shop_domain: 'gifts.myshopify.com',
                sell_on_whatsapp_enabled: true,
              }
            : table === 'whatsapp_config'
              ? { access_token: 'encrypted', phone_number_id: 'pn-1' }
              : table === 'conversations'
                ? {
                    id: 'conv-1',
                    contact: { id: 'contact-1', phone: '919876543210' },
                  }
                : h.saveError
                  ? null
                  : { id: 'message-1' },
        error:
          table === 'messages' && h.saveError
            ? { message: 'DB unavailable' }
            : null,
      });
      const chain = {
        select: () => chain,
        eq: () => chain,
        insert: () => chain,
        update: () => chain,
        single: async () => result(),
        maybeSingle: async () => result(),
      };
      return chain;
    },
  };
}
beforeEach(() => {
  h.saveError = true;
  h.send.mockResolvedValue({ messageId: 'wamid.accepted' });
});
const args = () => ({
  db: db() as never,
  accountId: 'acct-1',
  userId: 'user-1',
  conversationId: 'conv-1',
  contactId: 'contact-1',
  shopifyVariantIds: [101, 102],
  bodyText: 'Here are your picks.',
  skipAssigneeCheck: true,
  aiGenerated: true,
});

describe('carousel delivery receipts', () => {
  it('marks a persistence failure as already sent', async () => {
    await expect(sendShopifyProductCarousel(args())).rejects.toMatchObject({
      name: 'ProductCarouselAlreadySentError',
      whatsappMessageId: 'wamid.accepted',
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('leaves pre-delivery failures available for text fallback', async () => {
    const error = new MetaCarouselRejectedError('Meta rejected carousel', 400);
    h.send.mockRejectedValueOnce(error);
    await expect(sendShopifyProductCarousel(args())).rejects.toBe(error);
    expect(error).not.toBeInstanceOf(ProductCarouselAlreadySentError);
  });
  it('does not treat an unknown network outcome as safe to resend', async () => {
    h.send.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(sendShopifyProductCarousel(args())).rejects.toMatchObject({
      name: 'ProductCarouselDeliveryUncertainError',
    });
    expect(h.send).toHaveBeenCalledTimes(1);
  });
  it('returns the receipt after successful delivery and persistence', async () => {
    h.saveError = false;
    expect(await sendShopifyProductCarousel(args())).toMatchObject({
      whatsapp_message_id: 'wamid.accepted',
      product_count: 2,
    });
  });
});
