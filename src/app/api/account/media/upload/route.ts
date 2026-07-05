import { NextResponse } from 'next/server';

import { ForbiddenError, requireRole, toErrorResponse } from '@/lib/auth/account';
import { canSendMessages } from '@/lib/auth/roles';
import { buildMediaPath } from '@/lib/storage/upload-media';
import { supabaseAdmin } from '@/lib/supabase/admin';

const ALLOWED_BUCKETS = new Set(['chat-media', 'flow-media']);

/**
 * POST /api/account/media/upload
 *
 * Uploads a file to an account-scoped Storage path using the server's
 * account context (including super admins acting in a brand). Client-side
 * uploads keyed only on profiles.account_id fail for Recover Agent ops.
 */
export async function POST(request: Request) {
  try {
    const ctx = await requireRole('viewer');
    if (!canSendMessages(ctx.role)) {
      throw new ForbiddenError('Your role cannot upload media');
    }

    const form = await request.formData();
    const file = form.get('file');
    const bucket = form.get('bucket');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (typeof bucket !== 'string' || !ALLOWED_BUCKETS.has(bucket)) {
      return NextResponse.json({ error: 'Invalid bucket' }, { status: 400 });
    }

    const path = buildMediaPath(ctx.accountId, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseAdmin().storage.from(bucket).upload(path, buffer, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'application/octet-stream',
    });

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin().storage.from(bucket).getPublicUrl(path);

    return NextResponse.json({ publicUrl, path });
  } catch (err) {
    return toErrorResponse(err);
  }
}
