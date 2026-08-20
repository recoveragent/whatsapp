import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getServerRedirectOrigin } from "@/lib/auth/site-url";
import {
  completeSsoLogin,
  recoverAgentDashboardUrl,
  SsoError,
  ssoErrorHtml,
} from "@/lib/auth/sso";

export const dynamic = "force-dynamic";

function errorResponse(message: string): NextResponse {
  return new NextResponse(ssoErrorHtml(message, recoverAgentDashboardUrl()), {
    status: 400,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function publicSsoMessage(err: unknown): string {
  if (err instanceof SsoError) return err.publicMessage;
  return "Could not sign you in. Go back to the dashboard and try again.";
}

/**
 * Recover Agent dashboard SSO landing.
 * Public URL: GET /sso?ticket=<jwt>
 */
export async function GET(request: NextRequest) {
  const ticket = request.nextUrl.searchParams.get("ticket")?.trim() ?? "";
  if (!ticket) {
    return errorResponse(
      "This sign-in link is missing a ticket. Go back to the dashboard and open WhatsApp CRM again.",
    );
  }

  const origin =
    getServerRedirectOrigin(request) || new URL(request.url).origin;
  const redirectTo = `${origin}/`;

  let redirectResponse = NextResponse.redirect(redirectTo);
  redirectResponse.headers.set("Cache-Control", "no-store");

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          redirectResponse = NextResponse.redirect(redirectTo);
          redirectResponse.headers.set("Cache-Control", "no-store");
          cookiesToSet.forEach(({ name, value, options }) =>
            redirectResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  try {
    await completeSsoLogin(ticket, supabase);
    return redirectResponse;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[sso]", detail);
    return errorResponse(publicSsoMessage(err));
  }
}
