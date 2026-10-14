import { describe, expect, it, vi } from 'vitest';
import {
  crawlTrainingWebsite,
  publicTrainingAddress,
  trainingUrl,
  websiteLinks,
} from './training-crawl';

describe('safe public training crawl', () => {
  it.each([
    'http://shop.example.com',
    'https://127.0.0.1',
    'https://[::1]',
    'https://localhost',
    'https://internal.local',
    'https://user:password@shop.example.com',
    'https://shop.example.com:8443',
  ])('rejects unsafe URL %s', (url) => {
    expect(() => trainingUrl(url)).toThrow();
  });
  it('accepts a connected public store and strips query/hash', () => {
    expect(trainingUrl('gifts.myshopify.com/?token=secret#faq').href).toBe(
      'https://gifts.myshopify.com/'
    );
  });
  it.each([
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '100.64.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '203.0.113.2',
    '::ffff:127.0.0.1',
  ])('blocks non-public address %s', (ip) => {
    expect(publicTrainingAddress(ip)).toBe(false);
  });
  it('accepts public IPv4', () => {
    expect(publicTrainingAddress('8.8.8.8')).toBe(true);
  });
  it('follows only same-origin content links and prioritizes policies', () => {
    expect(
      websiteLinks(
        '<a href="/products/frame">Frame</a><a href="/policies/refund">Refund</a><a href="https://other.example.com/">Other</a><a href="/checkout">Pay</a><a href="mailto:x@y.com">Mail</a>',
        new URL('https://gifts.example.com/')
      )
    ).toEqual([
      'https://gifts.example.com/policies/refund',
      'https://gifts.example.com/products/frame',
    ]);
  });
  it('bounds the crawl to six pages and removes scripts', async () => {
    const fetch = vi.fn(async () => ({
      status: 200,
      html:
        '<title>Gifting Studio</title><script>invented secret text</script><p>' +
        'Personalized photo frames and prepaid delivery. '.repeat(5) +
        '</p>' +
        Array.from(
          { length: 12 },
          (_, i) => `<a href="/pages/faq-${i}">FAQ</a>`
        ).join(''),
    }));
    const result = await crawlTrainingWebsite(
      'https://gifts.example.com',
      fetch
    );
    expect(result.sources).toHaveLength(6);
    expect(fetch).toHaveBeenCalledTimes(6);
    expect(result.sources[0].text).not.toContain('invented secret');
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it('allows a public canonical root redirect but rejects unsafe redirect URLs', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({
      status: 302,
      location: 'https://localhost/admin',
      html: '',
    });
    await expect(
      crawlTrainingWebsite('https://gifts.example.com', fetch)
    ).rejects.toThrow('public HTTPS');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves partial source coverage and reports failures', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({
        status: 200,
        html:
          '<p>' +
          'Handmade photo frame delivery information. '.repeat(5) +
          '</p><a href="/pages/faq">FAQ</a>',
      })
      .mockRejectedValue(new Error('Page timed out'));
    const result = await crawlTrainingWebsite(
      'https://gifts.example.com',
      fetch
    );
    expect(result.sources).toHaveLength(1);
    expect(result.warnings[0]).toContain('Page timed out');
  });
  it('fails closed for unreadable sites rather than inventing training', async () => {
    await expect(
      crawlTrainingWebsite('https://gifts.example.com', async () => ({
        status: 200,
        html: '<div id="app"></div>',
      }))
    ).rejects.toThrow('too little');
  });
});
