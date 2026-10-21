export type DirectSendStatus = 'unknown' | 'enabled' | 'unavailable';
export function normalizeDirectSendStatus(value: unknown): DirectSendStatus {
  return value === 'enabled' || value === 'unavailable' ? value : 'unknown';
}
export function isDirectSendUnavailableError(message: string): boolean {
  return (
    /direct send/i.test(message) &&
    /(?:not|isn.t|is not) enabled|not eligible|ineligible|not onboarded|(?:not available|unavailable) (?:for|to) (?:this|your|the) (?:WhatsApp Business )?account/i.test(
      message
    )
  );
}
export const DIRECT_SEND_UNAVAILABLE_MESSAGE =
  'Direct Send access is not confirmed for this WhatsApp account. Use an approved message template instead.';
