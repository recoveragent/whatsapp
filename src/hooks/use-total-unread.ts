"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isOpenInboxConversation } from "@/lib/inbox/conversation-list";
import type { Conversation } from "@/types";

type ConvSnapshot = {
  unread: number;
  status: Conversation["status"];
  last_message_at: string | null;
};

function totalsFrom(map: Map<string, ConvSnapshot>) {
  let unread = 0;
  let open = 0;
  for (const row of map.values()) {
    if (row.unread > 0) unread += 1;
    if (isOpenInboxConversation(row)) open += 1;
  }
  return { unread, open };
}

/**
 * Live inbox counts for the sidebar: unread conversations (at least one
 * unread inbound) and open conversations (status = open, has a message).
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
    // no explicit user_id filter needed here.
    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id, unread_count, status, last_message_at");
      if (cancelled || error || !data) return;

      const map = new Map<string, ConvSnapshot>();
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
      rowsRef.current = map;
      setCounts(totalsFrom(map));
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
