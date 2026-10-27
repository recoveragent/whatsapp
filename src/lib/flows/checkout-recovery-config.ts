export interface CheckoutRecoveryNodeConfig {
  action: 'prepare_cod' | 'place_cod';
  cod_mode: 'checkout' | 'create_order';
  ready_next: string;
  checkout_next: string;
  failed_next: string;
}

export const CHECKOUT_RECOVERY_BRANCHES = [
  { id: 'ready', field: 'ready_next', label: 'Ready / order placed' },
  { id: 'checkout', field: 'checkout_next', label: 'Continue on checkout' },
  { id: 'failed', field: 'failed_next', label: 'Needs assistance' },
] as const;

export function checkoutRecoveryConfigErrors(c: Record<string, unknown>) {
  const errors: Array<{ field: string; message: string }> = [];
  if (!['prepare_cod', 'place_cod'].includes(String(c.action)))
    errors.push({
      field: 'action',
      message: 'Select a checkout recovery action.',
    });
  if (!['checkout', 'create_order'].includes(String(c.cod_mode)))
    errors.push({
      field: 'cod_mode',
      message: 'Select how COD customers complete their order.',
    });
  return errors;
}
