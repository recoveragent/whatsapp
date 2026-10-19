import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentLink } from './razorpay';

export interface CashfreeCredentials {
  client_id: string;
  client_secret: string;
  environment: 'production' | 'sandbox';
}
export interface CashfreeLink {
  link_id: string;
  link_url: string;
  link_status: string;
  link_currency: string;
  link_amount: number;
  link_amount_paid: number;
}
export async function cashfreeRequest<T>(
  credentials: CashfreeCredentials,
  path: string,
  body?: unknown,
  idempotencyKey?: string
): Promise<T> {
  const host =
    credentials.environment === 'sandbox'
      ? 'https://sandbox.cashfree.com'
      : 'https://api.cashfree.com';
  const response = await fetch(`${host}/pg/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': '2026-01-01',
      'x-client-id': credentials.client_id,
      'x-client-secret': credentials.client_secret,
      ...(idempotencyKey ? { 'x-idempotency-key': idempotencyKey } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(
      `Cashfree request failed (${response.status}). Check credentials, environment and Payment Links access.`
    );
  return response.json() as Promise<T>;
}

function paise(amount: number): number {
  if (
    typeof amount !== 'number' ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001
  )
    throw new Error('Cashfree returned an invalid amount.');
  return Math.round(amount * 100);
}
/** Normalize provider amounts (rupees) and statuses for the shared verified resolver. */
export function normalizeCashfreeLink(link: CashfreeLink): PaymentLink {
  return {
    id: link.link_id,
    reference_id: link.link_id,
    short_url: link.link_url,
    status:
      (
        { PAID: 'paid', EXPIRED: 'expired', CANCELLED: 'cancelled' } as Record<
          string,
          string
        >
      )[link.link_status] ?? 'pending',
    currency: link.link_currency,
    amount: paise(link.link_amount),
    amount_paid: paise(link.link_amount_paid),
  };
}
export function validCashfreeSignature(
  raw: string,
  timestamp: string,
  signature: string,
  secret: string
): boolean {
  if (!/^\d+$/.test(timestamp) || !/^[A-Za-z0-9+/]{43}=$/.test(signature))
    return false;
  const expected = createHmac('sha256', secret)
    .update(timestamp + raw)
    .digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}
