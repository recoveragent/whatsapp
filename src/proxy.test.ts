import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));
vi.mock('@supabase/ssr', () => ({
  createServerClient: () => ({ auth: { getUser } }),
}));

import { proxy } from './proxy';

describe('Settings navigation caching', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not cache an unauthenticated Settings prefetch redirect', async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const response = await proxy(new NextRequest('https://wa.test/settings', {
      headers: { 'next-router-prefetch': '1', RSC: '1' },
    }));
    expect(response.headers.get('location')).toBe('https://wa.test/login');
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  it('lets authenticated Settings navigation continue without a redirect', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(new NextRequest('https://wa.test/settings'));
    expect(response.headers.get('location')).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('does not cache the signed-in login redirect to Dashboard', async () => {
    getUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
    const response = await proxy(new NextRequest('https://wa.test/login'));
    expect(response.headers.get('location')).toBe('https://wa.test/dashboard');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
});
