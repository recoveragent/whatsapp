import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ widget: null as unknown, update: vi.fn(), select: vi.fn(), result: { data: { id: 'chat' }, error: null } as { data: unknown; error: unknown } }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({ from: () => ({
  update: h.update, select: h.select,
}) }) }));
vi.mock('@/lib/website-widget/config', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/website-widget/config')>();
  return { ...original, loadEnabledWidget: async () => h.widget };
});
vi.mock('@/lib/rate-limit', () => ({ RATE_LIMITS: { widgetConfig: {}, widgetVisitor: {} }, checkRateLimit: () => ({ success: true }) }));
import { POST } from './route';

beforeEach(() => {
  h.widget = { account_id: 'brand', allowed_domains: ['example.com'] };
  h.result = { data: { id: 'chat' }, error: null };
  const session = { eq: vi.fn(), maybeSingle: vi.fn(async () => h.result) };
  session.eq.mockReturnValue(session);
  const turns = { eq: vi.fn(), order: vi.fn(), limit: vi.fn(async () => ({ data: [], error: null })) };
  turns.eq.mockReturnValue(turns);
  turns.order.mockReturnValue(turns);
  h.select.mockImplementation((columns: string) => columns === 'id' ? session : turns);
  const updateChain = { eq: vi.fn() };
  updateChain.eq.mockReturnValue(updateChain);
  h.update.mockReturnValue(updateChain);
});
const req = (phone: string, country_code = '+91', origin = 'https://example.com') => new Request('https://app.test/api/widget/phone?key=x', {
  method: 'POST', headers: { origin }, body: JSON.stringify({ session_key: 'a'.repeat(64), phone, country_code }),
});

describe('website phone capture', () => {
  it('saves a 10-digit number with its country code to the matching account session', async () => {
    expect((await POST(req('9876543210'))).status).toBe(200);
    expect(h.update).toHaveBeenCalledWith({ phone: '+919876543210' });
    const chain = h.update.mock.results[0].value;
    expect(chain.eq).toHaveBeenCalledWith('account_id', 'brand');
    expect(chain.eq).toHaveBeenCalledWith('id', 'chat');
    expect(h.select.mock.results[0].value.eq).toHaveBeenCalledWith('session_hash', expect.stringMatching(/^[0-9a-f]{64}$/));
  });
  it.each(['123456789', '12345678901', 'abcdefghij', '98765 4321'])('rejects invalid number %s', async (phone) => {
    expect((await POST(req(phone))).status).toBe(400);
  });
  it('rejects an invalid country code or unlisted origin', async () => {
    expect((await POST(req('9876543210', '91'))).status).toBe(400);
    expect((await POST(req('9876543210', '+91', 'https://evil.test'))).status).toBe(404);
  });
  it('does not claim success if the session was not saved', async () => {
    h.result = { data: null, error: null };
    expect((await POST(req('9876543210'))).status).toBe(503);
  });
});
