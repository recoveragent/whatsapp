import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testAdmin, type Row } from './test-admin';
import { maintainInstagramTokens } from './token';

vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: (v: string) => v.replace('enc:', ''), encrypt: (v: string) => `enc:${v}` }));

const NOW = Date.parse('2026-11-24T10:00:00Z');
const DAY = 24 * 3600_000;
const at = (days: number) => Math.floor((NOW + days * DAY) / 1000);
const iso = (days: number) => new Date(NOW + days * DAY).toISOString();
const scopes = ['instagram_basic', 'instagram_manage_messages'];
type Info = { is_valid: boolean; expires_at: number; scopes: string[]; app_id: string };
const info = (over: Partial<Info> = {}): Info => ({ is_valid: true, expires_at: at(10), scopes, app_id: 'app', ...over });

/** Stub Meta: debug info per token, and the token a renewal returns. */
function stubMeta(tokens: Record<string, Info>, renewed: string | null = 'new') {
  const f = vi.fn(async (input: string | URL) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/debug_token')) {
      const data = tokens[url.searchParams.get('input_token')!];
      return data ? new Response(JSON.stringify({ data })) : new Response('{}', { status: 500 });
    }
    return renewed ? new Response(JSON.stringify({ access_token: renewed })) : new Response('{"error":{}}', { status: 400 });
  });
  vi.stubGlobal('fetch', f);
  return { renewals: () => f.mock.calls.filter(([u]) => String(u).includes('fb_exchange_token')).length };
}
const setup = (over: Row = {}) => {
  const t = testAdmin({ instagram_connections: [{ id: 'c1', access_token: 'enc:old', token_expires_at: null, token_checked_at: null, token_error: null, ...over }] });
  return { ...t, row: t.tables.instagram_connections[0] };
};

beforeEach(() => { vi.stubEnv('META_APP_ID', 'app'); vi.stubEnv('META_APP_SECRET', 'secret'); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Instagram login renewal', () => {
  it('records a distant expiry without renewing', async () => {
    const meta = stubMeta({ old: info({ expires_at: at(50) }) });
    const { admin, row } = setup({ token_error: 'earlier problem' });
    expect(await maintainInstagramTokens(admin, NOW)).toEqual({ checked: 1, renewed: 0, problems: 0 });
    expect(row).toMatchObject({ access_token: 'enc:old', token_expires_at: iso(50), token_error: null });
    expect(meta.renewals()).toBe(0);
  });

  it('replaces a login that is close to expiring', async () => {
    stubMeta({ old: info(), new: info({ expires_at: at(60) }) });
    const { admin, row } = setup();
    expect((await maintainInstagramTokens(admin, NOW)).renewed).toBe(1);
    expect(row).toMatchObject({ access_token: 'enc:new', token_expires_at: iso(60), token_error: null });
  });

  it('keeps the working login when the new one is worse, and says to reconnect', async () => {
    const worse: (Info | null)[] = [info({ is_valid: false }), info({ expires_at: at(5) }), info({ expires_at: at(60), scopes: ['instagram_basic'] }), info({ expires_at: at(60), app_id: 'other' }), null];
    for (const fresh of worse) {
      stubMeta(fresh ? { old: info(), new: fresh } : { old: info() }, fresh ? 'new' : null);
      const { admin, row } = setup();
      expect((await maintainInstagramTokens(admin, NOW)).problems).toBe(1);
      expect(row.access_token).toBe('enc:old');
      expect(row.token_error).toContain('Reconnect');
    }
  });

  it('flags a login Meta says is invalid', async () => {
    const meta = stubMeta({ old: info({ is_valid: false }) });
    const { admin, row } = setup();
    await maintainInstagramTokens(admin, NOW);
    expect(row.token_error).toContain('no longer valid');
    expect(meta.renewals()).toBe(0);
  });

  it('never overwrites a login the user reconnected meanwhile', async () => {
    const { admin, row } = setup();
    stubMeta({ old: info(), new: info({ expires_at: at(60) }) });
    const original = fetch;
    vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => { if (String(args[0]).includes('fb_exchange_token')) row.access_token = 'enc:reconnected'; return original(...args); });
    expect((await maintainInstagramTokens(admin, NOW)).renewed).toBe(0);
    expect(row).toMatchObject({ access_token: 'enc:reconnected', token_error: null });
  });

  it('checks each login once a day, skips disconnected ones, and tolerates Meta being unavailable', async () => {
    stubMeta({});
    const recent = setup({ token_checked_at: iso(-0.5) });
    expect(await maintainInstagramTokens(recent.admin, NOW)).toEqual({ checked: 0, renewed: 0, problems: 0 });
    const gone = setup({ access_token: null });
    expect((await maintainInstagramTokens(gone.admin, NOW)).checked).toBe(0);
    const down = setup();
    expect((await maintainInstagramTokens(down.admin, NOW)).problems).toBe(1);
    expect(down.row).toMatchObject({ access_token: 'enc:old', token_error: null });
  });
});
