import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";

function webhookBaseUrl(request: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const host = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? request.headers.get("host")?.trim();
  if (host) {
    const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim()
      ?? new URL(request.url).protocol.replace(":", "");
    return `${proto}://${host}`;
  }
  return "http://localhost:3000";
}

/**
 * GET /api/whatsapp/webhook-setup
 *
 * Brand admins — callback URL + verify token for Meta webhook configuration.
 */
export async function GET(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const { data: config, error } = await ctx.supabase
      .from("whatsapp_config")
      .select("verify_token, registered_at, phone_number_id")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error || !config?.phone_number_id) {
      return NextResponse.json(
        { error: "No WhatsApp configuration for this workspace" },
        { status: 404 },
      );
    }

    const base = webhookBaseUrl(request);
    const callbackUrl = `${base}/api/whatsapp/webhook`;
    const isLocalhost =
      base.includes("localhost") || base.includes("127.0.0.1");

    let verifyToken: string | null = null;
    if (config.verify_token) {
      try {
        verifyToken = decrypt(config.verify_token);
      } catch {
        return NextResponse.json(
          {
            error:
              "Stored webhook verify token cannot be decrypted. Reconnect WhatsApp or ask Recover Agent ops to reset the configuration.",
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      callbackUrl,
      verifyToken,
      isLocalhost,
      registered: Boolean(config.registered_at),
      note: isLocalhost
        ? "Meta cannot POST to localhost. Use ngrok (or deploy) and paste the public HTTPS callback URL in Meta → WhatsApp → Configuration."
        : null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
