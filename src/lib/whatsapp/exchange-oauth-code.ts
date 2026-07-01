import { META_API_VERSION } from '@/lib/whatsapp/meta-api';

interface TokenExchangeResponse {
  access_token?: string;
  token_type?: string;
  expires_in?: number;
  error?: { message?: string; type?: string; code?: number };
}

/**
 * Exchange an Embedded Signup OAuth code for a customer-scoped business token.
 *
 * When using the JavaScript SDK flow, omit redirect_uri — Meta rejects
 * mismatched redirect URIs for this grant type.
 */
export async function exchangeEmbeddedSignupCode(code: string): Promise<string> {
  const appId = process.env.NEXT_PUBLIC_META_APP_ID ?? process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!appId) {
    throw new Error('META_APP_ID is not configured on the server');
  }
  if (!appSecret) {
    throw new Error('META_APP_SECRET is not configured');
  }

  const url = new URL(
    `https://graph.facebook.com/${META_API_VERSION}/oauth/access_token`,
  );
  url.searchParams.set('client_id', appId);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);

  const response = await fetch(url.toString(), { method: 'GET' });
  const data = (await response.json()) as TokenExchangeResponse;

  if (!response.ok || !data.access_token) {
    const message =
      data.error?.message ??
      `Token exchange failed (${response.status})`;
    throw new Error(message);
  }

  return data.access_token;
}
