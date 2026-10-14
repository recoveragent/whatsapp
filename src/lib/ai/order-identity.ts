import { normalizePhone } from '@/lib/whatsapp/phone-utils';

/** Unlike fuzzy inbox contact discovery, automatic disclosure of order data
 * must never rely on an eight-digit suffix. Accept the full number or the
 * known Indian domestic form of a WhatsApp +91 number. Other ambiguous
 * domestic/country-code combinations require human verification.
 */
export function aiOrderPhoneMatches(
  orderPhone: string,
  contactPhone: string
): boolean {
  const order = normalizePhone(orderPhone);
  const contact = normalizePhone(contactPhone);
  if (order.length < 8 || contact.length < 8) return false;
  if (order === contact) return true;
  if (/^91[6-9]\d{9}$/.test(contact)) {
    const local = contact.slice(2);
    return order === local || order === `0${local}` || order === `910${local}`;
  }
  return false;
}
