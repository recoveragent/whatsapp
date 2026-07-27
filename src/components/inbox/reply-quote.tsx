"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message } from "@/types";

interface ReplyQuoteProps {
  /** Sender label of the quoted message: "You" for our own messages,
   *  contact name for customer-sent messages. Caller resolves this — the
   *  quote component doesn't see the parent Message. */
  authorLabel: string;
  /** Compact text preview. Falls back to a placeholder for media types. */
  preview: string;
  /** Present → renders the composer-chip variant with an X button. Absent →
   *  renders the embedded-in-bubble variant. */
  onDismiss?: () => void;
  /** Jump to the quoted message in the thread (bubble variant only). */
  onClick?: () => void;
  /** True when embedded inside an outbound (primary-filled) bubble, so the
   *  quote must read against the primary surface rather than the neutral
   *  foreground — otherwise it goes low-contrast in light mode. */
  onPrimary?: boolean;
}

export function ReplyQuote({
  authorLabel,
  preview,
  onDismiss,
  onClick,
  onPrimary = false,
}: ReplyQuoteProps) {
  const isChip = !!onDismiss;
  const clickable = !!onClick && !isChip;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={
        clickable
          ? (e) => {
              e.stopPropagation();
              onClick();
            }
          : undefined
      }
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onClick();
              }
            }
          : undefined
      }
      className={cn(
        "flex items-start gap-2 border-l-2 px-2 py-1",
        onPrimary ? "border-primary-foreground/50" : "border-primary",
        isChip
          ? "rounded-md bg-muted/80"
          : onPrimary
            ? "mb-1.5 rounded-md bg-primary-foreground/15"
            : "mb-1.5 rounded-md bg-background/20",
        clickable &&
          "cursor-pointer transition-colors hover:bg-background/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        clickable && onPrimary && "hover:bg-primary-foreground/25",
      )}
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div
          className={cn(
            "truncate text-[11px] font-medium",
            onPrimary ? "text-primary-foreground" : "text-primary",
          )}
        >
          {authorLabel}
        </div>
        {/* Cap at two visual lines. `break-words` wraps long URLs that have
         *  no whitespace; without `min-w-0` on the flex chain a long quote
         *  used to push the inbox layout wider (issue #165). */}
        <div
          className={cn(
            "line-clamp-2 whitespace-pre-wrap break-words text-xs",
            onPrimary ? "text-primary-foreground/80" : "text-foreground/80",
          )}
        >
          {preview}
        </div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          aria-label="Cancel reply"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

const MEDIA_CONTENT_TYPES = new Set<Message["content_type"]>([
  "image",
  "video",
  "audio",
  "document",
]);

/** Keep only the first two newline-delimited lines of a text preview. */
function firstTwoLines(text: string): string {
  const lines = text.split(/\r?\n/);
  if (lines.length <= 2) return text;
  return lines.slice(0, 2).join("\n");
}

/** Build the compact preview text shown inside a reply quote. */
export function buildReplyPreview(message: Message): string {
  if (MEDIA_CONTENT_TYPES.has(message.content_type)) {
    return "Replied to media";
  }
  if (message.content_text) return firstTwoLines(message.content_text);
  switch (message.content_type) {
    case "location":
      return "[Location]";
    case "template":
      return "[Template]";
    default:
      return "[Message]";
  }
}
