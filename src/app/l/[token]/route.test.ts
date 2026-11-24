import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ rpc }) }));
import { GET, HEAD } from './route';

const token = 'abcdefghijklmnop1234';
const open = (handler: typeof GET, t = token, agent = 'Mozilla/5.0 (iPhone) Instagram 300') => handler(new Request(`https://app.test/l/${t}`, { headers: { 'user-agent': agent } }), { params: Promise.resolve({ token: t }) });
beforeEach(() => rpc.mockReset().mockResolvedValue({ data: 'https://shop.test/p', error: null }));

describe('GET /l/[token]', () => {
  it('counts a visit from a person and redirects without caching', async () => {
    const response = await open(GET);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://shop.test/p');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(rpc).toHaveBeenCalledWith('instagram_comment_click', { p_token: token, p_count: true });
  });
  it('does not count link previews or HEAD checks', async () => {
    await open(GET, token, 'facebookexternalhit/1.1');
    await open(HEAD);
    expect(rpc.mock.calls.map((c) => c[1].p_count)).toEqual([false, false]);
  });
  it('rejects bad tokens and unsafe targets', async () => {
    expect((await open(GET, 'x')).status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
    for (const data of [null, 'javascript:alert(1)', 'http://shop.test']) {
      rpc.mockResolvedValueOnce({ data, error: null });
      expect((await open(GET)).status).toBe(404);
    }
    rpc.mockResolvedValueOnce({ data: null, error: { code: 'x' } });
    expect((await open(GET)).status).toBe(503);
  });
});
