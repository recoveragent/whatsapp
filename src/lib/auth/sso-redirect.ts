import { pickValidE164Phone } from "@/lib/whatsapp/phone-utils";

/** Same-origin relative path only — blocks open redirects (`//evil.com`). */
export function isSafeRelativePath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}

/**
 * Where SSO should send the user after session cookies are set.
 *
 * Priority:
 * 1. Safe `redirect` query param (may include its own query string, e.g. phone)
 * 2. `/inbox?phone=<E.164>` when a standalone `phone` param is valid
 * 3. `/dashboard`
 */
export function resolveSsoPostLoginPath(
  redirectParam: string | null | undefined,
  phoneCandidates: string[],
): string {
  const redirect = redirectParam?.trim();
  if (redirect && isSafeRelativePath(redirect)) {
    return redirect;
  }

  const phone = pickValidE164Phone(phoneCandidates);
  if (phone) {
    return `/inbox?phone=${encodeURIComponent(phone)}`;
  }

  return "/dashboard";
}
