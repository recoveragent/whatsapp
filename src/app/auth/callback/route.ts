import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getServerRedirectOrigin } from "@/lib/auth/site-url";

/**
 * Supabase auth redirect target — exchanges the `code` query param for
 * a session, then sends the user to `next` (e.g. /reset-password).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const origin = getServerRedirectOrigin(request);
  const code = searchParams.get("code");
  const nextRaw = searchParams.get("next") ?? "/dashboard";
  // Only allow same-origin relative paths.
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//")
    ? nextRaw
    : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Missing auth code")}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession:", error.message);
    return NextResponse.redirect(
      `${origin}/login?error=${encodeURIComponent("Could not verify link. Request a new one.")}`,
    );
  }

  return NextResponse.redirect(`${origin}${next}`);
}
