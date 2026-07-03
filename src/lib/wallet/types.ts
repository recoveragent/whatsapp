export type MessagePricingCategory = 'utility' | 'marketing' | 'authentication';

export type WalletTransactionType = 'credit' | 'debit';

export const MESSAGE_PRICING_CATEGORIES: MessagePricingCategory[] = [
  'utility',
  'marketing',
  'authentication',
];

export const MESSAGE_PRICING_LABELS: Record<MessagePricingCategory, string> = {
  utility: 'Utility',
  marketing: 'Marketing',
  authentication: 'Authentication',
};

/** Map Meta template category to wallet pricing key. */
export function templateCategoryToPricing(
  category: string | null | undefined,
): MessagePricingCategory | null {
  if (!category) return null;
  const normalized = category.trim().toLowerCase();
  if (normalized === 'utility') return 'utility';
  if (normalized === 'marketing') return 'marketing';
  if (normalized === 'authentication') return 'authentication';
  return null;
}

export interface WalletBalance {
  balancePaise: number;
  currency: string;
}

export interface MessagePricingRow {
  category: MessagePricingCategory;
  pricePaise: number;
}

export interface WalletTransaction {
  id: string;
  type: WalletTransactionType;
  amountPaise: number;
  gstPaise: number;
  balanceAfterPaise: number;
  category: MessagePricingCategory | null;
  referenceType: string;
  referenceId: string | null;
  description: string;
  status: string;
  createdAt: string;
}

export interface WalletDailyRow {
  date: string;
  transactionCount: number;
  creditPaise: number;
  debitPaise: number;
  balanceAfterPaise: number;
}
