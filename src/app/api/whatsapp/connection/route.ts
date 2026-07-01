import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { verifyPhoneNumber } from "@/lib/whatsapp/meta-api";

/**
 * GET /api/whatsapp/connection
 *
 * Brand-facing status — no API credentials exposed. Ops configures
 * tokens via /admin/brands/[id]/whatsapp.
 */
export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    const { data: config, error } = await ctx.supabase
      .from("whatsapp_config")
      .select(
        "phone_number_id, status, registered_at, connected_at, last_registration_error",
      )
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    if (error) {
      console.error("[GET /api/whatsapp/connection]", error);
      return NextResponse.json(
        { error: "Failed to load connection status" },
        { status: 500 },
      );
    }

    if (!config?.phone_number_id) {
      return NextResponse.json({
        configured: false,
        connected: false,
        message:
          "No WhatsApp number is connected yet. Contact Recover Agent to complete setup.",
      });
    }

    const { data: fullRow } = await ctx.supabase
      .from("whatsapp_config")
      .select("access_token")
      .eq("account_id", ctx.accountId)
      .maybeSingle();

    let phoneInfo: {
      verified_name?: string;
      display_phone_number?: string;
    } | null = null;
    let connected = config.status === "connected";

    if (fullRow?.access_token) {
      try {
        const accessToken = decrypt(fullRow.access_token);
        phoneInfo = await verifyPhoneNumber({
          phoneNumberId: config.phone_number_id,
          accessToken,
        });
        connected = true;
      } catch (err) {
        console.warn("[GET /api/whatsapp/connection] Meta verify failed:", err);
        connected = false;
      }
    }

    return NextResponse.json({
      configured: true,
      connected,
      phone_number_id: config.phone_number_id,
      verified_name: phoneInfo?.verified_name ?? null,
      display_phone_number: phoneInfo?.display_phone_number ?? null,
      status: config.status,
      registered: Boolean(config.registered_at),
      registered_at: config.registered_at,
      last_registration_error: config.last_registration_error,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
