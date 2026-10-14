import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendInteractiveMediaCarousel } from './meta-api';
import { MetaCarouselRejectedError } from './carousel-errors';

const args = {
  phoneNumberId: 'pn-1',
  accessToken: 'test-token',
  to: '919876543210',
  bodyText: 'Here are your picks.',
  cards: [0, 1].map((cardIndex) => ({
    cardIndex,
    imageUrl: 'https://cdn.test/image.jpg',
    bodyText: 'Hoodie',
    buttonLabel: 'Buy now',
    url: 'https://store.test/cart/101:1',
  })),
};
afterEach(() => vi.unstubAllGlobals());

describe('carousel transport error classification', () => {
  it('preserves the HTTP rejection status for safe fallback decisions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { message: 'Unsupported carousel', code: 100 } },
            { status: 400 }
          )
        )
    );
    await expect(sendInteractiveMediaCarousel(args)).rejects.toMatchObject({
      name: 'MetaCarouselRejectedError',
      status: 400,
    });
  });
  it('does not classify an unknown network outcome as an explicit rejection', async () => {
    const error = new TypeError('fetch failed');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
    await expect(sendInteractiveMediaCarousel(args)).rejects.toBe(error);
    expect(error).not.toBeInstanceOf(MetaCarouselRejectedError);
  });
});
