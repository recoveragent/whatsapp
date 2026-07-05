/**
 * Canonical public site URL for auth redirects and invite links.
 *
 * Client auth flows must not use `window.location.origin` when it is
 * 0.0.0.0 or localhost on a production deployment. Server routes use
 * NEXT_PUBLIC_SITE_URL / SITE_URL first, then trusted proxy headers.
 */

const BLOCKED_HOSTS = new Set(["0.0.0.0", "127.0.0.1", "localhost"]);

function normalizeSiteUrl(raw: string | undefined | null): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
}

function isBlockedOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return BLOCKED_HOSTS.has(host);
  } catch {
    return true;
  }
}

export function getConfiguredSiteUrl(): string | null {
  return (
    normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL) ??
    normalizeSiteUrl(process.env.SITE_URL)
  );
}

/** Browser — redirect target for Supabase auth emails. */
export function getClientAuthRedirectOrigin(): string {
  const configured = getConfiguredSiteUrl();
  if (configured) return configured;

  if (typeof window !== "undefined") {
    const origin = window.location.origin;
    if (!isBlockedOrigin(origin)) return origin;
  }

  return "";
}

/** Server — redirect target for auth emails and /auth/callback. */
export function getServerRedirectOrigin(request: Request): string {
  const configured = getConfiguredSiteUrl();
  if (configured) return configured;

  const forwardedHost = request.headers
    .get("x-forwarded-host")
    ?.split(",")[0]
    ?.trim();
  const forwardedProto = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim();

  if (forwardedHost && !BLOCKED_HOSTS.has(forwardedHost.split(":")[0].toLowerCase())) {
    return `${forwardedProto || "https"}://${forwardedHost}`;
  }

  const origin = new URL(request.url).origin;
  if (!isBlockedOrigin(origin)) return origin;

  return "";
}
