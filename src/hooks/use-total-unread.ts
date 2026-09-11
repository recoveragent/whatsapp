"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isActiveOpenInboxConversation } from "@/lib/inbox/conversation-list";
import type { Conversation } from "@/types";

type ConvSnapshot = {
  unread: number;
  status: Conversation["status"];
  last_message_at: string | null;
};

const PAGE_SIZE = 1000;

function totalsFrom(map: Map<string, ConvSnapshot>, now = new Date()) {
  let unread = 0;
  let open = 0;
  for (const row of map.values()) {
    if (row.unread > 0) unread += 1;
    if (isActiveOpenInboxConversation(row, now)) open += 1;
  }
  return { unread, open };
}

async function fetchAllConversationSnapshots(
  supabase: ReturnType<typeof createClient>,
) {
  const map = new Map<string, ConvSnapshot>();
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("conversations")
      .select("id, unread_count, status, last_message_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data?.length) break;

    for (const row of data as {
      id: string;
      unread_count: number;
      status: Conversation["status"];
      last_message_at: string | null;
    }[]) {
      map.set(row.id, {
        unread: row.unread_count ?? 0,
        status: row.status,
        last_message_at: row.last_message_at ?? null,
      });
    }

    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return map;
}

/**
 * Live inbox counts for the sidebar: unread conversations (at least one
 * unread inbound) and active open conversations (status = open, has a
 * message, last message within 24 hours).
 *
 * Lives on its own realtime channel (distinct from the inbox page's
 * "inbox-realtime") so both can coexist without sharing state.
 */
export function useInboxNavCounts(): { unread: number; open: number } {
  const [counts, setCounts] = useState({ unread: 0, open: 0 });

  // Keep a live local mirror so INSERT/UPDATE/DELETE events can adjust
  // both totals in O(n) without refetching.
  const rowsRef = useRef<Map<string, ConvSnapshot>>(new Map());

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    // Initial load. RLS scopes this to the signed-in user automatically —
    // no explicit user_id filter needed here. Paginate past PostgREST's
    // default 1 000-row cap so large accounts get accurate counts.
    (async () => {
      try {
        const map = await fetchAllConversationSnapshots(supabase);
        if (cancelled) return;
        rowsRef.current = map;
        setCounts(totalsFrom(map));
      } catch (error) {
        console.error("Failed to load inbox nav counts:", error);
      }
    })();

    const channel = supabase
      .channel("inbox-nav-counts-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        (payload) => {
          const map = rowsRef.current;
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as Partial<Conversation>;
            if (oldRow.id) map.delete(oldRow.id);
          } else {
            const row = payload.new as Conversation;
            map.set(row.id, {
              unread: row.unread_count ?? 0,
              status: row.status,
              last_message_at: row.last_message_at ?? null,
            });
          }
          setCounts(totalsFrom(map));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, []);

  return counts;
}
