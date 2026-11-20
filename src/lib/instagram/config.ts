export function instagramConfig() {
  const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
  const secret = process.env.META_APP_SECRET;
  const configId = process.env.META_INSTAGRAM_CONFIG_ID;
  const site = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL;
  if (!appId || !secret || !configId || !site) throw new Error('Instagram login is not configured');
  const origin = new URL(site).origin;
  if (!origin.startsWith('https://')) throw new Error('Instagram login requires an HTTPS site URL');
  return { appId, secret, configId, origin, redirect: `${origin}/api/instagram/callback` };
}
