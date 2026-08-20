// ============================================================
// Recover Agent dashboard SSO — consume a one-time ticket and
// establish this app's real Supabase session.
//
// The dashboard redirects here with `?ticket=<jwt>`. We POST that
// ticket to the Recover Agent `sso-consume` function (app = "wa").
// Tickets last 60s and are single-use. This module must NEVER
// store or verify SSO_TICKET_SECRET — only the dashboard project
// holds that.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { supabaseAdmin } from "@/lib/supabase/admin";

export const SSO_APP = "wa" as const;

export const SSO_CONSUME_URL =
  "https://huyoveugeexdhyqhawvq.supabase.co/functions/v1/sso-consume";

export const RECOVER_AGENT_PROJECT_REF = "huyoveugeexdhyqhawvq";

export const DEFAULT_DASHBOARD_URL = "https://app.recoveragent.ai";

/**
 * Publishable anon key for the Recover Agent dashboard project.
 * Required to invoke `sso-consume`. This is not a ticket secret.
 */
const SSO_CONSUME_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh1eW92ZXVnZWV4ZGh5cWhhd3ZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI0NjUyMDMsImV4cCI6MjA4ODA0MTIwM30.NDbox6KeRJ9FG_TGc6f5yjolaqh51KClrXlP6afFByg";

const CONSUME_TIMEOUT_MS = 10_000;

export class SsoError extends Error {
  readonly publicMessage: string;
  constructor(publicMessage: string, detail?: string) {
    super(detail ?? publicMessage);
    this.name = "SsoError";
    this.publicMessage = publicMessage;
  }
}

export interface SsoIdentity {
  email: string;
  user_id?: string;
  company_id?: string;
  roles?: unknown;
}

export interface SsoConsumeResponse {
  identity: SsoIdentity;
  hashed_token?: string;
}

export function recoverAgentDashboardUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_RECOVER_AGENT_DASHBOARD_URL?.trim() ||
    DEFAULT_DASHBOARD_URL;
  return raw.replace(/\/+$/, "");
}

/** True when this app's Supabase project is the Recover Agent dashboard project. */
export function usesSharedRecoverAgentAuth(
  supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
): boolean {
  const trimmed = supabaseUrl.trim();
  if (!trimmed) return false;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return host === `${RECOVER_AGENT_PROJECT_REF}.supabase.co`;
  } catch {
    return trimmed.includes(RECOVER_AGENT_PROJECT_REF);
  }
}

export function ssoConsumeBody(ticket: string): { ticket: string; app: typeof SSO_APP } {
  return { ticket, app: SSO_APP };
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function parseSsoConsumeResponse(raw: unknown): SsoConsumeResponse {
  if (!raw || typeof raw !== "object") {
    throw new SsoError(
      "Could not sign you in.",
      "sso-consume returned a non-object body",
    );
  }

  const body = raw as Record<string, unknown>;
  const identityRaw = body.identity;
  if (!identityRaw || typeof identityRaw !== "object") {
    throw new SsoError(
      "Could not sign you in.",
      "sso-consume response is missing identity",
    );
  }

  const identityObj = identityRaw as Record<string, unknown>;
  const email = asNonEmptyString(identityObj.email)?.toLowerCase();
  if (!email) {
    throw new SsoError(
      "Could not sign you in.",
      "sso-consume identity is missing email",
    );
  }

  const hashed = asNonEmptyString(body.hashed_token);
  return {
    identity: {
      email,
      user_id: asNonEmptyString(identityObj.user_id),
      company_id: asNonEmptyString(identityObj.company_id),
      roles: identityObj.roles,
    },
    hashed_token: hashed,
  };
}

export async function consumeSsoTicket(
  ticket: string,
  fetchImpl: typeof fetch = fetch,
): Promise<SsoConsumeResponse> {
  let response: Response;
  try {
    response = await fetchImpl(SSO_CONSUME_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SSO_CONSUME_ANON_KEY,
        Authorization: `Bearer ${SSO_CONSUME_ANON_KEY}`,
      },
      body: JSON.stringify(ssoConsumeBody(ticket)),
      signal: AbortSignal.timeout(CONSUME_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");
    throw new SsoError(
      timedOut
        ? "Sign-in timed out. Go back to the dashboard and try again."
        : "Could not reach Recover Agent sign-in. Go back to the dashboard and try again.",
      err instanceof Error ? err.message : "sso-consume fetch failed",
    );
  }

  const raw = await response.json().catch(() => null);

  if (!response.ok) {
    const remote =
      raw && typeof raw === "object" && "error" in raw
        ? asNonEmptyString((raw as { error?: unknown }).error)
        : undefined;
    throw new SsoError(
      "This sign-in link is invalid or has expired. Tickets last 60 seconds and can be used once.",
      remote ?? `sso-consume HTTP ${response.status}`,
    );
  }

  return parseSsoConsumeResponse(raw);
}

async function verifyMagicLink(
  supabase: SupabaseClient,
  email: string,
  tokenHash: string,
): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: tokenHash,
    email,
  });
  if (error) {
    throw new SsoError(
      "Could not start a session for this account.",
      error.message,
    );
  }
}

/**
 * Establish this app's normal login session from a dashboard identity
 * when we do not share Auth users (or no hashed_token was returned).
 */
export async function createSessionFromIdentity(
  supabase: SupabaseClient,
  identity: SsoIdentity,
): Promise<void> {
  const email = identity.email.trim().toLowerCase();
  if (!email) {
    throw new SsoError(
      "Could not sign you in.",
      "SSO identity is missing email",
    );
  }

  const { data, error } = await supabaseAdmin().auth.admin.generateLink({
    type: "magiclink",
    email,
  });

  const tokenHash = data.properties?.hashed_token;
  if (error || !tokenHash) {
    throw new SsoError(
      "No WhatsApp CRM account for this email. Ask an admin to invite you, then try again from the dashboard.",
      error?.message ?? "generateLink did not return hashed_token",
    );
  }

  await verifyMagicLink(supabase, email, tokenHash);
}

export function shouldUseSharedHashedToken(
  hashedToken: string | undefined,
  supabaseUrl?: string,
): boolean {
  return Boolean(hashedToken) && usesSharedRecoverAgentAuth(supabaseUrl);
}

/**
 * Consume the dashboard ticket and write a real session onto `supabase`
 * (the SSR / route-handler client, so cookies land on the response).
 */
export async function completeSsoLogin(
  ticket: string,
  supabase: SupabaseClient,
): Promise<SsoIdentity> {
  const trimmed = ticket.trim();
  if (!trimmed) {
    throw new SsoError(
      "This sign-in link is missing a ticket. Go back to the dashboard and open WhatsApp CRM again.",
    );
  }

  const consumed = await consumeSsoTicket(trimmed);

  if (shouldUseSharedHashedToken(consumed.hashed_token)) {
    await verifyMagicLink(
      supabase,
      consumed.identity.email,
      consumed.hashed_token as string,
    );
    return consumed.identity;
  }

  await createSessionFromIdentity(supabase, consumed.identity);
  return consumed.identity;
}

export function ssoErrorHtml(message: string, dashboardUrl: string): string {
  const safeMessage = escapeHtml(message);
  const safeDashboard = escapeHtml(dashboardUrl);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Sign-in failed — Recover Agent</title>
    <link rel="icon" href="/recover-agent-icon.png" type="image/png" />
    <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@500,600,700,800,900&amp;display=swap" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        font-family: "Cabinet Grotesk", sans-serif;
        background: hsl(220 20% 97%);
        color: hsl(222 18% 12%);
      }
      .card {
        width: 100%;
        max-width: 28rem;
        background: #fff;
        border: 1px solid hsl(220 14% 88%);
        border-radius: 0.75rem;
        padding: 1.75rem 1.5rem 1.5rem;
        text-align: center;
      }
      img { height: 48px; width: auto; margin-bottom: 1rem; }
      h1 { margin: 0 0 0.5rem; font-size: 1.25rem; font-weight: 700; }
      p {
        margin: 0 0 1.25rem;
        font-size: 0.95rem;
        line-height: 1.45;
        color: hsl(220 10% 46%);
      }
      a {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 2.5rem;
        padding: 0 1rem;
        border-radius: 0.375rem;
        background: #00a357;
        color: #fff;
        font-weight: 600;
        font-size: 0.875rem;
        text-decoration: none;
      }
      a:hover { filter: brightness(0.95); }
    </style>
  </head>
  <body>
    <main class="card">
      <img src="/recover-agent-logo.png" alt="Recover Agent" />
      <h1>Could not sign you in</h1>
      <p>${safeMessage}</p>
      <a href="${safeDashboard}">Back to dashboard</a>
    </main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
