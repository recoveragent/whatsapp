import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ insert: vi.fn(), cleanup: vi.fn(), widget: null as unknown }));
vi.mock('@/lib/ai/admin-client', () => ({ supabaseAdmin: () => ({ from: () => ({
  delete: () => ({ lt: h.cleanup }), insert: h.insert,
}) }) }));
vi.mock('@/lib/website-widget/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/website-widget/config')>();
  return { ...actual, loadEnabledWidget: async () => h.widget };
});
vi.mock('@/lib/rate-limit', () => ({ RATE_LIMITS: { widgetConfig: {}, widgetVisitor: {} }, checkRateLimit: () => ({ success: true }) }));
import { POST } from './route';

beforeEach(() => {
  h.widget = { account_id: 'account', allowed_domains: ['example.com'], whatsapp_number: '919876543210' };
  h.cleanup.mockResolvedValue({ error: null });
  h.insert.mockResolvedValue({ error: null });
});
const request = (origin = 'https://example.com', messages: unknown = [{ role: 'user', content: 'Need help' }]) => new Request('https://app.test/api/widget/handoff?key=x', { method: 'POST', headers: { origin }, body: JSON.stringify({ messages }) });

describe('website handoff endpoint', () => {
  it('saves the selected conversation and returns a reference for WhatsApp', async () => {
    const response = await POST(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.url).toContain('wa.me/919876543210');
    expect(decodeURIComponent(body.url)).toMatch(/WEB-[0-9a-f]{32}/);
    expect(h.insert).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'account', transcript: 'Visitor: Need help' }));
  });
  it('rejects unlisted origins and invalid transcripts', async () => {
    expect((await POST(request('https://evil.test'))).status).toBe(404);
    expect((await POST(request('https://example.com', [{ role: 'system', content: 'x' }]))).status).toBe(400);
  });
});
