import { describe, expect, it } from 'vitest';

import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';

import { toAdminPresetErrorResponse } from './admin-template-preset-errors';

describe('toAdminPresetErrorResponse', () => {
  it('maps URL button validation to 400 (requires, not required)', async () => {
    const res = toAdminPresetErrorResponse(
      new Error(
        'URL button #1 uses {{1}} — Meta requires an example value.',
      ),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'URL button #1 uses {{1}} — Meta requires an example value.',
    });
  });

  it('maps not-found preset errors to 404', async () => {
    const res = toAdminPresetErrorResponse(
      new Error('Unknown template preset.'),
    );
    expect(res.status).toBe(404);
  });

  it('maps auth errors to 401/403', async () => {
    expect(
      toAdminPresetErrorResponse(new UnauthorizedError()).status,
    ).toBe(401);
    expect(toAdminPresetErrorResponse(new ForbiddenError()).status).toBe(403);
  });

  it('maps Supabase-style plain objects to 500', async () => {
    const res = toAdminPresetErrorResponse({
      message: 'duplicate key value violates unique constraint',
      code: '23505',
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal server error' });
  });
});
