import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface RazorpayCredentials {
  key_id: string;
  key_secret: string;
  webhook_secret: string;
}
export interface PaymentLink {
  id: string;
  short_url: string;
  status: string;
  amount: number;
  amount_paid: number;
  currency: string;
  reference_id: string;
}

export async function razorpayRequest<T>(
  credentials: Pick<RazorpayCredentials, 'key_id' | 'key_secret'>,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${credentials.key_id}:${credentials.key_secret}`).toString('base64')}`,
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Razorpay request failed (${response.status}). Check the connected account and Payment Links access.`
    );
  return response.json() as Promise<T>;
}

export function validPaymentSignature(
  raw: string,
  signature: string,
  secret: string
): boolean {
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}

export function verifiedLinkOutcome(
  link: PaymentLink,
  expected: { id: string; provider_link_id: string; amount_paise: number }
): 'paid' | 'expired' | 'failed' | null {
  if (
    link.id !== expected.provider_link_id ||
    link.reference_id !== expected.id ||
    link.currency !== 'INR' ||
    link.amount !== expected.amount_paise
  )
    throw new Error('Payment link does not match this collection.');
  if (link.status === 'paid' && link.amount_paid === expected.amount_paise)
    return 'paid';
  if (link.status === 'expired') return 'expired';
  if (link.status === 'cancelled') return 'failed';
  return null;
}
