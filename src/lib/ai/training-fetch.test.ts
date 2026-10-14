import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({
  lookup: vi.fn(),
  request: vi.fn(),
  status: 200,
  type: 'text/html',
  location: '',
  body: '<p>Brand facts.</p>',
}));
vi.mock('node:dns/promises', () => ({ lookup: h.lookup }));
vi.mock('node:https', () => ({ request: h.request }));
import { fetchTrainingPage } from './training-crawl';
beforeEach(() => {
  h.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  h.status = 200;
  h.type = 'text/html';
  h.location = '';
  h.body = '<p>Brand facts.</p>';
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
    ).toBe(h.body);
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
    ).rejects.toThrow('not readable');
  });
  it('caps response buffering', async () => {
    h.body = 'x'.repeat(1_000_001);
    await expect(
      fetchTrainingPage(
        new URL('https://gifts.example.com'),
        AbortSignal.timeout(1000)
      )
    ).rejects.toThrow('1 MB');
  });
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
