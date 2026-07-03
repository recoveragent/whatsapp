import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';

export interface PaymentConfigPublic {
  provider: string;
  keyId: string;
  gstRate: number;
  isEnabled: boolean;
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
}

export interface PaymentConfigSecrets {
  keySecret: string;
  webhookSecret: string | null;
}

export async function getOrgPaymentConfig(
  organizationId: string,
): Promise<(PaymentConfigPublic & Partial<PaymentConfigSecrets>) | null> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('organization_payment_config')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!data) return null;

  let keySecret = '';
  let webhookSecret: string | null = null;
  if (data.key_secret_encrypted) {
    try {
      keySecret = decrypt(data.key_secret_encrypted as string);
    } catch {
      keySecret = '';
    }
  }
  if (data.webhook_secret_encrypted) {
    try {
      webhookSecret = decrypt(data.webhook_secret_encrypted as string);
    } catch {
      webhookSecret = null;
    }
  }

  return {
    provider: data.provider as string,
    keyId: data.key_id as string,
    gstRate: Number(data.gst_rate ?? 0.18),
    isEnabled: Boolean(data.is_enabled),
    hasKeySecret: Boolean(data.key_secret_encrypted),
    hasWebhookSecret: Boolean(data.webhook_secret_encrypted),
    keySecret,
    webhookSecret,
  };
}

export async function upsertOrgPaymentConfig(args: {
  organizationId: string;
  keyId: string;
  keySecret?: string;
  webhookSecret?: string;
  gstRate?: number;
  isEnabled?: boolean;
}): Promise<void> {
  const db = supabaseAdmin();
  const existing = await db
    .from('organization_payment_config')
    .select('key_secret_encrypted, webhook_secret_encrypted')
    .eq('organization_id', args.organizationId)
    .maybeSingle();

  const payload: Record<string, unknown> = {
    organization_id: args.organizationId,
    provider: 'razorpay',
    key_id: args.keyId.trim(),
    gst_rate: args.gstRate ?? 0.18,
    is_enabled: args.isEnabled ?? false,
    updated_at: new Date().toISOString(),
  };

  if (args.keySecret?.trim()) {
    payload.key_secret_encrypted = encrypt(args.keySecret.trim());
  } else if (existing.data?.key_secret_encrypted) {
    payload.key_secret_encrypted = existing.data.key_secret_encrypted;
  }

  if (args.webhookSecret?.trim()) {
    payload.webhook_secret_encrypted = encrypt(args.webhookSecret.trim());
  } else if (existing.data?.webhook_secret_encrypted) {
    payload.webhook_secret_encrypted = existing.data.webhook_secret_encrypted;
  }

  const { error } = await db
    .from('organization_payment_config')
    .upsert(payload, { onConflict: 'organization_id' });

  if (error) throw error;
}

export function toPublicPaymentConfig(
  config: Awaited<ReturnType<typeof getOrgPaymentConfig>>,
): PaymentConfigPublic | null {
  if (!config) return null;
  return {
    provider: config.provider,
    keyId: config.keyId,
    gstRate: config.gstRate,
    isEnabled: config.isEnabled,
    hasKeySecret: config.hasKeySecret,
    hasWebhookSecret: config.hasWebhookSecret,
  };
}
