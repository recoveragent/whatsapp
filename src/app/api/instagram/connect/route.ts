import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireRole, toErrorResponse } from '@/lib/auth/account';
import { instagramConfig } from '@/lib/instagram/config';

export async function POST() {
  try {
    const ctx = await requireRole('admin');
    const cfg = instagramConfig();
    const state = randomBytes(32).toString('hex');
    const url = new URL('https://www.facebook.com/dialog/oauth');
    for (const [k, v] of Object.entries({ client_id: cfg.appId, config_id: cfg.configId, redirect_uri: cfg.redirect, response_type: 'code', prompt: 'login', state })) url.searchParams.set(k, v);
    const response = NextResponse.json({ url: url.toString() });
    response.cookies.set('instagram_oauth', `${state}.${ctx.accountId}.${ctx.userId}`, { httpOnly: true, secure: true, sameSite: 'lax', path: '/api/instagram/callback', maxAge: 600 });
    return response;
  } catch (err) { return toErrorResponse(err); }
}
