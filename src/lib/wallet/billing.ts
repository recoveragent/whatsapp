import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  templateCategoryToPricing,
  type MessagePricingCategory,
} from '@/lib/wallet/types';

export class InsufficientWalletBalanceError extends Error {
  readonly status = 402 as const;
  constructor(message = 'Insufficient wallet balance. Please recharge your wallet.') {
    super(message);
    this.name = 'InsufficientWalletBalanceError';
  }
}

export async function getWalletBalancePaise(accountId: string): Promise<number> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('account_wallets')
    .select('balance_paise')
    .eq('account_id', accountId)
    .maybeSingle();
  return Number(data?.balance_paise ?? 0);
}

export async function getMinMessagePricePaise(accountId: string): Promise<number> {
  const db = supabaseAdmin();
  const { data } = await db
    .from('account_message_pricing')
    .select('price_paise')
    .eq('account_id', accountId);
  const prices = (data ?? []).map((r) => Number(r.price_paise ?? 0)).filter((p) => p > 0);
  if (prices.length === 0) return 0;
  return Math.min(...prices);
}

export async function getMessagePricePaise(
  accountId: string,
  templateCategory: string | null | undefined,
): Promise<number> {
  const category = templateCategoryToPricing(templateCategory);
  if (!category) return 0;

  const db = supabaseAdmin();
  const { data } = await db
    .from('account_message_pricing')
    .select('price_paise')
    .eq('account_id', accountId)
    .eq('category', category)
    .maybeSingle();
  return Number(data?.price_paise ?? 0);
}

/** Pre-send guard for batch template sends (broadcasts). */
export async function assertWalletCanSendBatch(
  accountId: string,
  templateCategory: string | null | undefined,
  count: number,
): Promise<void> {
  const price = await getMessagePricePaise(accountId, templateCategory);
  if (price <= 0 || count <= 0) return;

  const balance = await getWalletBalancePaise(accountId);
  if (balance < price * count) {
    throw new InsufficientWalletBalanceError(
      `Insufficient wallet balance for ${count} messages. Please recharge your wallet.`,
    );
  }
}

/** Pre-send guard — throws if balance cannot cover cheapest priced message. */
export async function assertWalletCanSend(
  accountId: string,
  templateCategory?: string | null,
): Promise<void> {
  const category = templateCategoryToPricing(templateCategory);
  const db = supabaseAdmin();

  let required = 0;
  if (category) {
    const { data } = await db
      .from('account_message_pricing')
      .select('price_paise')
      .eq('account_id', accountId)
      .eq('category', category)
      .maybeSingle();
    required = Number(data?.price_paise ?? 0);
  } else {
    required = await getMinMessagePricePaise(accountId);
  }

  if (required <= 0) return;

  const balance = await getWalletBalancePaise(accountId);
  if (balance < required) {
    throw new InsufficientWalletBalanceError();
  }
}

/** Debit wallet after a successful template send. Session messages are free. */
export async function debitWalletForTemplateSend(args: {
  accountId: string;
  templateCategory: string | null | undefined;
  messageId: string;
  templateName?: string | null;
}): Promise<void> {
  const category = templateCategoryToPricing(args.templateCategory);
  if (!category) return;

  const db = supabaseAdmin();
  const description = args.templateName
    ? `${category} template: ${args.templateName}`
    : `${category} message`;

  const { error } = await db.rpc('debit_wallet_for_message', {
    p_account_id: args.accountId,
    p_category: category as MessagePricingCategory,
    p_reference_id: args.messageId,
    p_description: description,
  });

  if (error) {
    const detail = String(error.message ?? '');
    if (detail.toLowerCase().includes('insufficient')) {
      console.warn('[wallet] debit failed after send — insufficient balance:', args.accountId);
      return;
    }
    console.error('[wallet] debit_wallet_for_message failed:', error);
  }
}
