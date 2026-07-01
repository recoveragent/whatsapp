"use client";

import { Lock } from "lucide-react";
import { format } from "date-fns";

import type { ConversationPrivateNote } from "@/types";

interface PrivateNoteBubbleProps {
  note: ConversationPrivateNote;
}

/** Agent-only note rendered inline in the conversation timeline. */
export function PrivateNoteBubble({ note }: PrivateNoteBubbleProps) {
  return (
    <div className="flex justify-center px-2">
      <div className="w-full max-w-md rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 shadow-sm">
        <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400">
          <Lock className="h-3 w-3" />
          Private note · agents only
        </div>
        <p className="whitespace-pre-wrap text-sm text-foreground">{note.note_text}</p>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          {format(new Date(note.created_at), "HH:mm")}
        </p>
      </div>
    </div>
  );
}
