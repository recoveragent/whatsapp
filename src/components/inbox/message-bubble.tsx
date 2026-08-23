"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Phone,
  ExternalLink,
  Copy,
} from "lucide-react";
import type { TemplateButton } from "@/types";
import {
  isMediaHeaderType,
  type TemplateMessageSnapshot,
} from "@/lib/inbox/template-message-display";
import { format } from "date-fns";
import { toast } from "sonner";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { openMediaUrl, useProxiedMediaUrl } from "./use-proxied-media";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  /** Scroll the thread to the quoted parent message. */
  onReplyClick?: () => void;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** Shown above the bubble (contact name, agent name, Automation, etc.). */
  senderLabel?: string;
  /** Resolved template header/footer/buttons for template messages. */
  templateDisplay?: TemplateMessageSnapshot | null;
}

function MessageStatusLabel({
  status,
  onPrimary,
}: {
  status: Message["status"];
  onPrimary: boolean;
}) {
  const muted = onPrimary ? "text-primary-foreground/75" : "text-muted-foreground";
  const label =
    status === "sending"
      ? "Sending…"
      : status === "sent"
        ? "Sent"
        : status === "delivered"
          ? "Delivered"
          : status === "read"
            ? "Read"
            : status === "failed"
              ? "Failed"
              : null;

  if (!label) return null;

  return (
    <span
      className={cn(
        "text-[10px] font-medium",
        status === "failed"
          ? onPrimary
            ? "text-red-200"
            : "text-red-500"
          : status === "read"
            ? onPrimary
              ? "text-sky-200"
              : "text-sky-500"
            : muted,
      )}
    >
      {label}
    </span>
  );
}

function MediaUnavailable({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <ImageOff className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span>{label} unavailable</span>
    </div>
  );
}

function MediaImage({
  url,
  alt,
  className,
}: {
  url: string;
  alt: string;
  className?: string;
}) {
  const { src, loading, error } = useProxiedMediaUrl(url);
  const [open, setOpen] = useState(false);
  const [imgError, setImgError] = useState(false);

  if (error || imgError) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center bg-muted",
          className ?? "w-60 rounded-lg",
        )}
      >
        <ImageOff className="h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className={cn(
          "flex h-40 items-center justify-center bg-muted",
          className ?? "w-60 rounded-lg",
        )}
      >
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "block cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className ? "w-full" : "rounded-lg",
        )}
        aria-label="Open image"
      >
        <img
          src={src ?? ""}
          alt={alt}
          className={cn(
            "object-cover",
            className ?? "max-h-64 max-w-60 rounded-lg",
          )}
          onError={() => setImgError(true)}
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showCloseButton
          className="max-w-[min(92vw,56rem)] border-none bg-transparent p-2 shadow-none ring-0 sm:max-w-[min(92vw,56rem)]"
        >
          <img
            src={src ?? ""}
            alt={alt}
            className="mx-auto max-h-[85vh] w-auto max-w-full rounded-lg object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProxiedVideo({ url }: { url: string }) {
  const { src, loading, error } = useProxiedMediaUrl(url);

  if (error) return <MediaUnavailable label="Video" />;
  if (loading) {
    return (
      <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <video
      src={src ?? ""}
      controls
      className="max-h-64 max-w-60 rounded-lg"
    />
  );
}

function ProxiedAudio({ url }: { url: string }) {
  const { src, loading, error } = useProxiedMediaUrl(url);

  if (error) return <MediaUnavailable label="Audio" />;
  if (loading) {
    return (
      <div className="flex h-10 w-60 items-center justify-center rounded-lg bg-muted">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return <audio src={src ?? ""} controls className="max-w-60" />;
}

function ProxiedDocumentLink({
  url,
  label,
}: {
  url: string;
  label: string;
}) {
  const [opening, setOpening] = useState(false);

  return (
    <button
      type="button"
      disabled={opening}
      onClick={() => {
        setOpening(true);
        void openMediaUrl(url, label)
          .catch(() => toast.error("Failed to open document"))
          .finally(() => setOpening(false));
      }}
      className="flex w-full items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-60"
    >
      <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function TemplateButtonRow({
  button,
  onPrimary,
}: {
  button: TemplateButton;
  onPrimary: boolean;
}) {
  const muted = onPrimary
    ? "text-primary-foreground/80"
    : "text-muted-foreground";
  const iconClass = cn("h-3.5 w-3.5 shrink-0", muted);

  let icon = null;
  if (button.type === "PHONE_NUMBER") icon = <Phone className={iconClass} />;
  else if (button.type === "URL") icon = <ExternalLink className={iconClass} />;
  else if (button.type === "COPY_CODE") icon = <Copy className={iconClass} />;

  return (
    <div
      className={cn(
        "flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-sm font-medium",
        onPrimary ? "text-primary-foreground" : "text-foreground",
      )}
    >
      {icon}
      <span>{button.text}</span>
    </div>
  );
}

function TemplateMessageContent({
  message,
  display,
  onPrimary,
}: {
  message: Message;
  display: TemplateMessageSnapshot | null;
  onPrimary: boolean;
}) {
  const buttons = display?.buttons ?? [];
  const headerMediaUrl =
    display?.header_media_url?.trim() || message.media_url?.trim() || null;

  return (
    <>
      {display?.header_type === "text" && display.header_content && (
        <p
          className={cn(
            "mb-1 text-sm font-semibold",
            onPrimary ? "text-primary-foreground" : "text-foreground",
          )}
        >
          {display.header_content}
        </p>
      )}
      {isMediaHeaderType(display?.header_type) && headerMediaUrl && (
        <div className="-mx-3 -mt-2 mb-2">
          {display.header_type === "image" ? (
            <MediaImage
              url={headerMediaUrl}
              alt="Template header"
              className="max-h-48 w-full"
            />
          ) : display.header_type === "video" ? (
            <ProxiedVideo url={headerMediaUrl} />
          ) : (
            <ProxiedDocumentLink url={headerMediaUrl} label="Document" />
          )}
        </div>
      )}
      {isMediaHeaderType(display?.header_type) && !headerMediaUrl && (
        <div className="mb-2">
          <MediaUnavailable
            label={
              display?.header_type === "image"
                ? "Image"
                : display?.header_type === "video"
                  ? "Video"
                  : "Document"
            }
          />
        </div>
      )}
      <span className="mb-1 inline-flex items-center gap-1 rounded bg-black/15 px-1.5 py-0.5 text-[10px] font-medium opacity-90">
        <LayoutTemplate className="h-3 w-3" />
        Template
        {message.template_name ? ` · ${message.template_name}` : ""}
      </span>
      {message.content_text && (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      )}
      {display?.footer_text && (
        <p
          className={cn(
            "mt-2 text-xs italic",
            onPrimary
              ? "text-primary-foreground/75"
              : "text-muted-foreground",
          )}
        >
          {display.footer_text}
        </p>
      )}
      {buttons.length > 0 && (
        <div
          className={cn(
            "-mx-3 mt-2 border-t",
            onPrimary ? "border-primary-foreground/20" : "border-border",
          )}
        >
          {buttons.map((button, index) => (
            <div
              key={`${button.type}-${button.text}-${index}`}
              className={cn(
                index > 0 && "border-t",
                onPrimary ? "border-primary-foreground/20" : "border-border",
              )}
            >
              <TemplateButtonRow button={button} onPrimary={onPrimary} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function MessageContent({
  message,
  templateDisplay,
  onPrimary,
}: {
  message: Message;
  templateDisplay?: TemplateMessageSnapshot | null;
  onPrimary: boolean;
}) {
  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt="Shared image" />
          ) : (
            <MediaUnavailable label="Image" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <ProxiedVideo url={message.media_url} />
          ) : (
            <MediaUnavailable label="Video" />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <ProxiedAudio url={message.media_url} />
          ) : (
            <MediaUnavailable label="Audio" />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return <MediaUnavailable label={message.content_text || "Document"} />;
      }
      if (message.media_url.startsWith("/api/whatsapp/media/")) {
        return (
          <ProxiedDocumentLink
            url={message.media_url}
            label={message.content_text || "Document"}
          />
        );
      }
      return (
        <a
          href={message.media_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm hover:bg-muted"
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {message.content_text || "Document"}
          </span>
        </a>
      );

    case "template":
      return (
        <TemplateMessageContent
          message={message}
          display={templateDisplay ?? null}
          onPrimary={onPrimary}
        />
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || "Location shared"}</span>
        </div>
      );

    case "interactive": {
      // Address Message submission — structured values live in
      // content_payload; content_text is the formatted multi-line summary.
      const isAddress =
        message.interactive_reply_id === "address_message" ||
        (message.content_payload &&
          (message.content_payload as { type?: string }).type ===
            "address_message");
      if (isAddress) {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <MapPin className="h-3 w-3" />
              Address
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || "[Address submitted]"}
            </p>
          </div>
        );
      }

      // Customer tapped a reply button or list row on a message the bot
      // sent. We show the tapped option's title (already in content_text,
      // set by parseMessageContent in the webhook) with a small affordance
      // so agents reading the inbox can tell at a glance that this is a
      // tap rather than the customer typing the same words.
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            <CornerDownLeft className="h-3 w-3" />
            Button reply
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || "[Interactive reply]"}
          </p>
        </div>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || "[Unsupported message type]"}
        </p>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  onReplyClick,
  reactions,
  currentUserId,
  onToggleReaction,
  senderLabel,
  templateDisplay,
}: MessageBubbleProps) {
  const time = format(new Date(message.created_at), "h:mm a");

  if (message.content_type === "system") {
    return (
      <div className="flex justify-center px-2 py-1">
        <p className="max-w-[90%] text-center text-[11px] leading-snug text-muted-foreground">
          {message.content_text || "Status updated"}
          <span className="whitespace-nowrap"> · {time}</span>
        </p>
      </div>
    );
  }

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      {senderLabel && (
        <span
          className={cn(
            "mb-1 px-1 text-[11px] font-medium text-muted-foreground",
            isAgent ? "text-right" : "text-left",
          )}
        >
          {senderLabel}
        </span>
      )}
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl px-3 py-2",
          isAgent
            ? "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-muted text-foreground",
        )}
      >
        {reply && (
          <ReplyQuote
            authorLabel={reply.authorLabel}
            preview={reply.preview}
            onClick={onReplyClick}
            onPrimary={isAgent}
          />
        )}
        <MessageContent
          message={message}
          templateDisplay={templateDisplay}
          onPrimary={isAgent}
        />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span
            className={cn(
              "text-[10px]",
              // Outbound bubbles sit on the primary fill, so the
              // timestamp must read against that (not the neutral
              // foreground) — otherwise it goes low-contrast in light
              // mode. Inbound bubbles use the muted surface.
              isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
            )}
          >
            {format(new Date(message.created_at), "HH:mm")}
          </span>
          {isAgent && (
            <MessageStatusLabel status={message.status} onPrimary={isAgent} />
          )}
        </div>
      </div>
      {message.status === "failed" && (
        <p
          className={cn(
            "mt-1 max-w-[min(100%,28rem)] text-[11px] leading-snug text-red-600 dark:text-red-400",
            isAgent ? "text-right" : "text-left",
          )}
          title={
            message.error_message ||
            "Delivery failed. Meta did not provide a reason for this message."
          }
        >
          {message.error_message ||
            "Delivery failed — reason not recorded for this message. New failures will show Meta’s error here."}
        </p>
      )}
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
