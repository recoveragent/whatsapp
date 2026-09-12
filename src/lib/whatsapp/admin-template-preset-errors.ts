import { NextResponse } from 'next/server';

import { ForbiddenError, UnauthorizedError } from '@/lib/auth/account';

const PRESET_NOT_FOUND = new Set([
  'Unknown template preset.',
  'Custom template not found.',
  'Template not found.',
]);

/**
 * Map preset save/load errors to HTTP responses. Validation and
 * business-rule failures from the preset store throw plain Error
 * instances with user-facing messages; Supabase errors are plain
 * objects and fall through to 500.
 */
export function toAdminPresetErrorResponse(err: unknown): NextResponse {
  if (err instanceof UnauthorizedError || err instanceof ForbiddenError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof Error) {
    if (PRESET_NOT_FOUND.has(err.message)) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
