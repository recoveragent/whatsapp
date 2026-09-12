import { NextResponse } from 'next/server';

import { toErrorResponse } from '@/lib/auth/account';
import { requireSuperAdmin } from '@/lib/auth/super-admin';
import { supabaseAdmin } from '@/lib/supabase/admin';

const BUCKET = 'chat-media';
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png']);

function orgTemplateHeaderPath(organizationId: string, fileName: string): string {
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split('.').pop()!.toLowerCase() : 'bin';
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 40) || 'file';
  return `org-${organizationId}/template-headers/${Date.now()}-${safeBase}.${ext}`;
}

/**
 * POST /api/admin/templates/media/upload
 *
 * Super-admin template gallery: store header sample images under an
 * org-scoped public path so presets can reference a durable URL before
 * pushing to many brands (each brand re-uploads to Meta on submit).
 */
export async function POST(request: Request) {
  try {
    const { organizationId } = await requireSuperAdmin();

    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }

    const contentType = (file.type || '').toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
      return NextResponse.json(
        { error: 'Header image must be JPEG or PNG.' },
        { status: 400 },
      );
    }
    if (file.size > IMAGE_MAX_BYTES) {
      return NextResponse.json(
        {
          error: `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — max is 5 MB.`,
        },
        { status: 400 },
      );
    }

    const path = orgTemplateHeaderPath(organizationId, file.name);
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: upErr } = await supabaseAdmin()
      .storage.from(BUCKET)
      .upload(path, buffer, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 400 });
    }

    const {
      data: { publicUrl },
    } = supabaseAdmin().storage.from(BUCKET).getPublicUrl(path);

    return NextResponse.json({ publicUrl, path });
  } catch (err) {
    return toErrorResponse(err);
  }
}
