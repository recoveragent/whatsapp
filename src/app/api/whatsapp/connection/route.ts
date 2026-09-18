import { NextResponse } from "next/server";

import {
  getCurrentAccount,
  requireRole,
  toErrorResponse,
} from "@/lib/auth/account";
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

    const { data: configs, error } = await ctx.supabase
      .from("whatsapp_config")
      .select(
        "id, reference_name, phone_number_id, status, registered_at, connected_at, last_registration_error, access_token",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/whatsapp/connection]", error);
      return NextResponse.json(
        { error: "Failed to load connection status" },
        { status: 500 },
      );
    }

    if (!configs?.length) {
      return NextResponse.json({
        configured: false,
        connected: false,
        needs_reconnect: false,
        message:
          "No WhatsApp number is connected yet. Use Connect with Meta to link your WhatsApp Business number.",
      });
    }

    const numbers = await Promise.all(configs.map(async (config) => {
      let phoneInfo: { verified_name?: string; display_phone_number?: string } | null = null;
      let connected = config.status === "connected";
      try {
        phoneInfo = await verifyPhoneNumber({
          phoneNumberId: config.phone_number_id,
          accessToken: decrypt(config.access_token),
        });
        connected = true;
      } catch (err) {
        console.warn("[GET /api/whatsapp/connection] Meta verify failed:", err);
        connected = false;
      }
      return {
        id: config.id,
        reference_name: config.reference_name,
        phone_number_id: config.phone_number_id,
        verified_name: phoneInfo?.verified_name ?? null,
        display_phone_number: phoneInfo?.display_phone_number ?? null,
        status: config.status,
        connected,
        needs_reconnect: !connected,
        registered: Boolean(config.registered_at),
        registered_at: config.registered_at,
        last_registration_error: config.last_registration_error,
      };
    }));
    const config = numbers[0];
    const connected = numbers.some((number) => number.connected);

    return NextResponse.json({
      configured: true,
      connected,
      needs_reconnect: !connected,
      numbers,
      phone_number_id: config.phone_number_id,
      verified_name: config.verified_name,
      display_phone_number: config.display_phone_number,
      status: config.status,
      registered: Boolean(config.registered_at),
      registered_at: config.registered_at,
      last_registration_error: config.last_registration_error,
      message: connected
        ? undefined
        : "This number is no longer valid with Meta (removed, revoked, or incomplete). Disconnect it, then connect a new number.",
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * DELETE /api/whatsapp/connection
 *
 * Brand admin — clears stored WhatsApp credentials so a new number can be linked.
 */
export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("admin");

    const configId = new URL(request.url).searchParams.get("id");
    if (!configId) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    const { error } = await ctx.supabase
      .from("whatsapp_config")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("id", configId);

    if (error) {
      console.error("[DELETE /api/whatsapp/connection]", error);
      return NextResponse.json(
        { error: "Failed to disconnect WhatsApp" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
