import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CONVERSATION_SELECT } from "@/lib/inbox/conversations";

const PAGE_SIZE = 30;
const STATUS_FILTERS = new Set(["open", "pending", "closed", "followup"]);

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const params = new URL(request.url).searchParams;
    const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
    const filter = params.get("filter") ?? "open";
    const cursor = params.get("cursor");
    const requestedPageSize = Number.parseInt(params.get("pageSize") ?? "", 10);
    const pageSize =
      requestedPageSize >= 1 && requestedPageSize <= PAGE_SIZE
        ? requestedPageSize
        : PAGE_SIZE;

    let query = ctx.supabase
      .from("conversations")
      .select(CONVERSATION_SELECT)
      .eq("account_id", ctx.accountId)
      .not("last_message_at", "is", null)
      .order("last_message_at", { ascending: sort === "oldest" });

    if (STATUS_FILTERS.has(filter)) {
      query = query.eq("status", filter);
    } else if (filter === "unread") {
      query = query.gt("unread_count", 0);
    }

    if (cursor) {
      query =
        sort === "oldest"
          ? query.gt("last_message_at", cursor)
          : query.lt("last_message_at", cursor);
    }

    // Fetch one extra row so the client can show the pagination control only
    // when another page truly exists. This also prevents a misleading empty
    // page after the last set of conversations.
    const { data, error } = await query.limit(pageSize + 1);
    if (error) {
      console.error("Failed to load inbox page:", error);
      return NextResponse.json(
        { error: "Failed to load conversations" },
        { status: 500 },
      );
    }

    const rows = data ?? [];
    const hasMore = rows.length > pageSize;
    return NextResponse.json({
      conversations: hasMore ? rows.slice(0, pageSize) : rows,
      hasMore,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
