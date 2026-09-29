import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { CONVERSATION_SELECT } from "@/lib/inbox/conversations";

const PAGE_SIZE = 30;
const STATUS_FILTERS = new Set(["open", "pending", "closed", "followup"]);

function escapeIlikeTerm(value: string): string {
  return value.replace(/[\\%_,()]/g, (character) => `\\${character}`);
}

export async function GET(request: Request) {
  try {
    const ctx = await requireRole("agent");
    const params = new URL(request.url).searchParams;
    const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
    const filter = params.get("filter") ?? "open";
    const search = params.get("search")?.trim() ?? "";
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

    if (search) {
      // Search is intentionally global across statuses. The inbox used to
      // fetch only the first page and then search that client-side, which
      // made older conversations impossible to recover by phone or name.
      const term = escapeIlikeTerm(search.slice(0, 100));
      const digits = search.replace(/\D/g, "");
      const phoneTerm = escapeIlikeTerm(digits || search.slice(0, 100));
      const contactSearch = [
        `name.ilike.%${term}%`,
        `phone.ilike.%${phoneTerm}%`,
      ].join(",");

      const { data: matchingContacts, error: contactError } = await ctx.supabase
        .from("contacts")
        .select("id")
        .eq("account_id", ctx.accountId)
        .or(contactSearch);

      if (contactError) {
        console.error("Failed to search inbox contacts:", contactError);
        return NextResponse.json(
          { error: "Failed to search conversations" },
          { status: 500 },
        );
      }

      const contactIds = (matchingContacts ?? []).map((contact) => contact.id);
      const conversationSearch = [`last_message_text.ilike.%${term}%`];
      if (contactIds.length > 0) {
        conversationSearch.push(`contact_id.in.(${contactIds.join(",")})`);
      }
      query = query.or(conversationSearch.join(","));
    } else if (STATUS_FILTERS.has(filter)) {
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
