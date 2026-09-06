import { buildEmbedInboxUrl } from "@/lib/embed/query";
import { redirectParamRequestsEmbed } from "@/lib/security/embed-headers";
import { pickValidE164Phone } from "@/lib/whatsapp/phone-utils";

/** Same-origin relative path only — blocks open redirects (`//evil.com`). */
export function isSafeRelativePath(path: string): boolean {
  const trimmed = path.trim();
  return trimmed.startsWith("/") && !trimmed.startsWith("//");
}

export interface SsoRedirectInput {
  redirectParam: string | null | undefined;
  phoneCandidates: string[];
  /** Top-level `?embed=1` on the `/sso` URL. */
  embedTopLevel?: boolean;
  /** Split `embed%3D1` query key when `&embed=1` was not encoded inside `redirect`. */
  hasSplitEmbedParam?: boolean;
}

/** True when this SSO hop targets the Recover Agent dashboard iframe. */
export function isSsoEmbedContext(input: SsoRedirectInput): boolean {
  const redirect = input.redirectParam?.trim() ?? "";
  if (input.embedTopLevel) return true;
  if (input.hasSplitEmbedParam) return true;
  if (redirectParamRequestsEmbed(input.redirectParam)) return true;
  if (redirect.startsWith("/inbox")) return true;
  return false;
}

function appendQueryParam(path: string, key: string, value: string): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}${key}=${encodeURIComponent(value)}`;
}

function ensureInboxEmbedParam(path: string): string {
  const [pathname, query = ""] = path.split("?");
  if (pathname !== "/inbox" && !pathname.startsWith("/inbox/")) return path;
  const params = new URLSearchParams(query);
  params.set("embed", "1");
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : `${pathname}?embed=1`;
}

/**
 * Rebuild a safe redirect when the dashboard SSO URL split `embed=1` or
 * `phone` out of the nested `redirect` query value.
 */
export function reconstructSsoRedirect(input: SsoRedirectInput): string | null {
  let redirect = input.redirectParam?.trim() ?? "";
  if (!redirect || !isSafeRelativePath(redirect)) return null;

  const embedContext = isSsoEmbedContext(input);

  if (embedContext && !/(?:^|[?&])embed=1(?:&|$)/.test(redirect)) {
    redirect = appendQueryParam(redirect, "embed", "1");
  }

  const phone = pickValidE164Phone(input.phoneCandidates);
  if (phone && !/(?:^|[?&])phone=/.test(redirect)) {
    redirect = appendQueryParam(redirect, "phone", phone);
  }

  if (embedContext && redirect.startsWith("/inbox")) {
    redirect = ensureInboxEmbedParam(redirect);
  }

  return redirect;
}

/**
 * Where SSO should send the user after session cookies are set.
 *
 * Priority:
 * 1. Safe reconstructed `redirect` (preserves phone + embed=1)
 * 2. `/inbox?phone=<E.164>&embed=1` when standalone `phone` is valid (embed SSO)
 * 3. `/inbox?embed=1` or `/inbox`
 */
export function resolveSsoPostLoginPath(input: SsoRedirectInput): string {
  const embedContext = isSsoEmbedContext(input);

  const reconstructed = reconstructSsoRedirect(input);
  if (reconstructed) return reconstructed;

  const phone = pickValidE164Phone(input.phoneCandidates);
  if (phone) {
    return embedContext
      ? buildEmbedInboxUrl({ phone })
      : `/inbox?phone=${encodeURIComponent(phone)}`;
  }

  return embedContext ? buildEmbedInboxUrl({}) : "/inbox";
}
