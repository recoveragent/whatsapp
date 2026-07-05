import { NextResponse } from "next/server";

import { getServerRedirectOrigin } from "@/lib/auth/site-url";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null;
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email is required" }, { status: 400 });
  }

  const origin = getServerRedirectOrigin(request);
  if (!origin) {
    return NextResponse.json(
      {
        error:
          "Password reset is not configured. Set NEXT_PUBLIC_SITE_URL to your public domain (e.g. https://wa.recoveragent.ai).",
      },
      { status: 503 },
    );
  }

  const redirectTo = `${origin}/auth/callback?next=/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  if (error) {
    console.error("[POST /api/auth/forgot-password]", error.message);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
