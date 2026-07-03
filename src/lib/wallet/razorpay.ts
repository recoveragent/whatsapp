import crypto from 'crypto';

export interface RazorpayOrderResponse {
  id: string;
  amount: number;
  currency: string;
  status: string;
}

export async function createRazorpayOrder(args: {
  keyId: string;
  keySecret: string;
  amountPaise: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<RazorpayOrderResponse> {
  const auth = Buffer.from(`${args.keyId}:${args.keySecret}`).toString('base64');
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: args.amountPaise,
      currency: 'INR',
      receipt: args.receipt,
      notes: args.notes ?? {},
    }),
  });

  const body = (await res.json().catch(() => ({}))) as RazorpayOrderResponse & {
    error?: { description?: string };
  };

  if (!res.ok) {
    throw new Error(body.error?.description ?? `Razorpay order failed (${res.status})`);
  }

  return body;
}

export function verifyRazorpayPaymentSignature(args: {
  orderId: string;
  paymentId: string;
  signature: string;
  keySecret: string;
}): boolean {
  const payload = `${args.orderId}|${args.paymentId}`;
  const expected = crypto
    .createHmac('sha256', args.keySecret)
    .update(payload)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(args.signature, 'hex'),
    );
  } catch {
    return false;
  }
}

export function verifyRazorpayWebhookSignature(args: {
  body: string;
  signature: string;
  webhookSecret: string;
}): boolean {
  const expected = crypto
    .createHmac('sha256', args.webhookSecret)
    .update(args.body)
    .digest('hex');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(args.signature, 'hex'),
    );
  } catch {
    return false;
  }
}
