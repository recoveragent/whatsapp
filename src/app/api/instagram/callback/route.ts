import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { instagramConfig } from '@/lib/instagram/config';
import { encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/automations/admin-client';

export async function GET(request: Request) {
  const cfg = instagramConfig();
  const done = (status: string) => {
    const response = NextResponse.redirect(`${cfg.origin}/settings?tab=instagram&instagram=${status}`);
    response.cookies.set('instagram_oauth', '', { path: '/api/instagram/callback', maxAge: 0, httpOnly: true, secure: true, sameSite: 'lax' });
    return response;
  };
  try {
    const ctx = await requireRole('admin');
    const { cookies } = await import('next/headers');
    const saved = (await cookies()).get('instagram_oauth')?.value.split('.');
    const params = new URL(request.url).searchParams;
    if (!saved || saved.length !== 3 || saved[0] !== params.get('state') || saved[1] !== ctx.accountId || saved[2] !== ctx.userId || !params.get('code')) return done('failed');
    const tokenUrl = new URL('https://graph.facebook.com/v27.0/oauth/access_token');
    for (const [k, v] of Object.entries({ client_id: cfg.appId, client_secret: cfg.secret, redirect_uri: cfg.redirect, code: params.get('code')! })) tokenUrl.searchParams.set(k, v);
    const tokenRes = await fetch(tokenUrl, { cache: 'no-store' });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || typeof tokenData.access_token !== 'string') return done('failed');
    const token = tokenData.access_token as string;
    const headers = { Authorization: `Bearer ${token}` };
    const [businessRes, accountsRes] = await Promise.all([
      fetch('https://graph.facebook.com/v27.0/me?fields=client_business_id', { headers, cache: 'no-store' }),
      fetch('https://graph.facebook.com/v27.0/me/assigned_instagram_accounts?fields=id,username&limit=100', { headers, cache: 'no-store' }),
    ]);
    const business = await businessRes.json();
    const accounts = await accountsRes.json();
    // Require exactly one account, including across pages, rather than silently
    // attaching an arbitrary asset to the current workspace.
    if (!businessRes.ok || !accountsRes.ok || typeof business.client_business_id !== 'string' || !Array.isArray(accounts.data) || accounts.data.length !== 1 || accounts.paging?.next) return done('select_one');
    const ig = accounts.data[0];
    if (!/^\d+$/.test(ig.id) || typeof ig.username !== 'string') return done('failed');
    const admin = supabaseAdmin();
    const { data: existing, error: lookupError } = await admin.from('instagram_connections').select('id').eq('instagram_id', ig.id).eq('account_id', ctx.accountId).maybeSingle();
    const { data: active, error: activeError } = await admin.from('instagram_connections').select('account_id').eq('instagram_id', ig.id).not('access_token', 'is', null).maybeSingle();
    if (lookupError || activeError || (active && active.account_id !== ctx.accountId)) return done('failed');
    const subscribe = await fetch(`https://graph.facebook.com/v27.0/${ig.id}/subscribed_apps`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ subscribed_fields: ['messages'] }) });
    const sub = await subscribe.json();
    if (!subscribe.ok || !sub.success) return done('failed');
    const values = { username: ig.username, client_business_id: business.client_business_id, access_token: encrypt(token) };
    const { error } = existing
      ? await admin.from('instagram_connections').update(values).eq('instagram_id', ig.id).eq('account_id', ctx.accountId)
      : await admin.from('instagram_connections').insert({ ...values, account_id: ctx.accountId, instagram_id: ig.id });
    if (error) return done('failed');
    return done('connected');
  } catch (error) { console.error('[instagram/callback] failed', error instanceof Error ? error.name : 'unknown'); return done('failed'); }
}
