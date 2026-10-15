import { EventEmitter } from 'node:events';
import { gzipSync, deflateSync, brotliCompressSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  status: 200,
  type: 'text/html',
  location: '',
  encoding: '',
  body: Buffer.from('<p>Brand facts.</p>'),
}));
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }));
vi.mock('node:https', () => ({ request: h.request }));
import { fetchTrainingPage } from './training-crawl';
beforeEach(() => {
  h.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  h.status = 200;
  h.type = 'text/html';
  h.location = '';
  h.encoding = '';
  h.body = Buffer.from('<p>Brand facts.</p>');
  h.request.mockImplementation((_url, _options, callback) => {
    const req = Object.assign(new EventEmitter(), {
      setTimeout: vi.fn(),
      destroy: (error: Error) => req.emit('error', error),
      end: () =>
        queueMicrotask(() => {
          const res = Object.assign(new EventEmitter(), {
            statusCode: h.status,
            headers: {
              'content-type': h.type,
              location: h.location || undefined,
              'content-encoding': h.encoding || undefined,
            },
            resume: vi.fn(),
          });
          callback(res);
          res.emit('data', Buffer.from(h.body));
          res.emit('end');
        }),
    });
    return req;
  });
});
describe('pinned website fetching', () => {
  it('pins the resolved public IP rather than resolving again at connect time', async () => {
    expect(
      (
        await fetchTrainingPage(
          new URL('https://gifts.example.com'),
          AbortSignal.timeout(1000)
        )
      ).html
    ).toBe(h.body.toString());
    expect(h.lookup).toHaveBeenCalledTimes(1);
    const [url, options] = h.request.mock.calls[0];
    expect(url.hostname).toBe('gifts.example.com');
    expect(options.agent).toBe(false);
    expect(options.headers.Authorization).toBeUndefined();
    const callback = vi.fn();
    options.lookup('gifts.example.com', { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [
      { address: '8.8.8.8', family: 4 },
    ]);
  });
  it('blocks mixed public/private DNS answers before opening a socket', async () => {
    h.lookup.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]);
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('non-public');
    expect(h.request).not.toHaveBeenCalled();
  });
  it('does not automatically follow a redirect', async () => {
    h.status = 302;
    h.location = 'https://localhost/private';
    expect(
      await fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).toEqual({ status: 302, location: h.location, html: '' });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('refuses non-HTML binary payloads', async () => {
    h.type = 'application/pdf';
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('instead of readable HTML/text');
  });
  it('caps response buffering', async () => {
    h.body = Buffer.alloc(1_000_001, 'x');
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('1 MB');
  });
  it.each([
    ['gzip', gzipSync],
    ['deflate', deflateSync],
    ['br', brotliCompressSync],
  ] as const)(
    'reads %s compressed storefront HTML',
    async (encoding, compress) => {
      const html =
        '<html><body>Published Shopify shipping and refund policies.</body></html>';
      h.encoding = encoding;
      h.body = compress(Buffer.from(html));
      expect(
        (
          await fetchTrainingPage(
            new URL('https://gifts.example.com'),
            AbortSignal.timeout(1000)
          )
        ).html
      ).toBe(html);
    }
  );
  it('rejects decompression bombs without buffering their expanded output', async () => {
    h.encoding = 'gzip';
    h.body = gzipSync(Buffer.alloc(1_000_001, 'x'));
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('1 MB decompressed');
  });
  it('reports corrupt compression separately from an unreadable website', async () => {
    h.encoding = 'gzip';
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('invalid compressed HTML');
  });
  it.each([403, 429, 503])(
    'reports HTTP %s instead of calling the page unreadable',
    async (status) => {
      h.status = status;
      await expect(
        fetchTrainingPage(
          new URL('https://gifts.example.com'),
          AbortSignal.timeout(1000)
        )
      ).rejects.toThrow(`HTTP ${status}`);
    }
  );
  it('bounds even stalled DNS resolution with the scan deadline', async () => {
    h.lookup.mockImplementation(() => new Promise(() => {}));
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(20)
      )
    ).rejects.toThrow('timed out');
    expect(h.request).not.toHaveBeenCalled();
  });
});
