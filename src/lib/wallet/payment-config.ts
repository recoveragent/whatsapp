import { decrypt, encrypt } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { encryptionConfigError } from '@/lib/wallet/db-errors';

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

function encryptSecret(value: string, label: string): string {
  try {
    return encrypt(value);
  } catch (err) {
    const hint = encryptionConfigError(err);
    throw new Error(hint ?? `Failed to encrypt ${label}`);
  }
}

export async function getOrgPaymentConfig(
  organizationId: string,
): Promise<(PaymentConfigPublic & Partial<PaymentConfigSecrets>) | null> {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('organization_payment_config')
    .select('*')
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) throw error;
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
  const { data: existing, error: existingErr } = await db
    .from('organization_payment_config')
    .select('key_secret_encrypted, webhook_secret_encrypted')
    .eq('organization_id', args.organizationId)
    .maybeSingle();

  if (existingErr) throw existingErr;

  const payload: Record<string, unknown> = {
    organization_id: args.organizationId,
    provider: 'razorpay',
    key_id: args.keyId.trim(),
    gst_rate: args.gstRate ?? 0.18,
    is_enabled: args.isEnabled ?? false,
    updated_at: new Date().toISOString(),
  };

  if (args.keySecret?.trim()) {
    payload.key_secret_encrypted = encryptSecret(args.keySecret.trim(), 'key secret');
  } else if (existing?.key_secret_encrypted) {
    payload.key_secret_encrypted = existing.key_secret_encrypted;
  } else {
    throw new Error('Razorpay key secret is required on first save');
  }

  if (args.webhookSecret?.trim()) {
    payload.webhook_secret_encrypted = encryptSecret(args.webhookSecret.trim(), 'webhook secret');
  } else if (existing?.webhook_secret_encrypted) {
    payload.webhook_secret_encrypted = existing.webhook_secret_encrypted;
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
