"use client";

import { cn } from "@/lib/utils";
import type { Message, MessageReaction } from "@/types";
import {
  MapPin,
  LayoutTemplate,
  CornerDownLeft,
  ClipboardList,
  Phone,
  ExternalLink,
  Copy,
  Sparkles,
} from "lucide-react";
import type { TemplateButton } from "@/types";
import {
  isMediaHeaderType,
  resolveUrlButtonHref,
  type TemplateMessageSnapshot,
} from "@/lib/inbox/template-message-display";
import { format } from "date-fns";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { FormSubmissionFields } from "./form-submission-fields";
import {
  MediaAudioBubble,
  MediaDocumentBubble,
  MediaImageBubble,
  MediaUnavailable,
  MediaVideoBubble,
} from "./message-media";
import { InteractivePreview } from "@/components/interactive/interactive-preview";
import { useTranslations } from "next-intl";

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
  /**
   * Opens the thread's media viewer on this message. Only images and videos
   * call it; omitted when the parent renders no viewer, in which case media
   * stays inline and non-clickable.
   */
  onOpenMedia?: (messageId: string) => void;
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

  const href =
    button.type === "URL" ? resolveUrlButtonHref(button.url) : null;

  const className = cn(
    "flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-sm font-medium",
    onPrimary ? "text-primary-foreground" : "text-foreground",
    href && "cursor-pointer transition-colors hover:underline",
  );

  const content = (
    <>
      {icon}
      <span>{button.text}</span>
    </>
  );

  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        {content}
      </a>
    );
  }

  return <div className={className}>{content}</div>;
}

function TemplateMessageContent({
  message,
  display,
  onPrimary,
  t,
  onOpenMedia,
}: {
  message: Message;
  display: TemplateMessageSnapshot | null;
  onPrimary: boolean;
  t: ReturnType<typeof useTranslations>;
  onOpenMedia?: (messageId: string) => void;
}) {
  const buttons = display?.buttons ?? [];
  const headerMediaUrl =
    display?.header_media_url?.trim() || message.media_url?.trim() || null;
  const headerMediaMessage: Message = {
    ...message,
    media_url: headerMediaUrl ?? undefined,
    content_type:
      display?.header_type === "video"
        ? "video"
        : display?.header_type === "document"
          ? "document"
          : "image",
  };
  const openHeaderMedia = onOpenMedia
    ? () => onOpenMedia(message.id)
    : undefined;

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
          {display?.header_type === "image" ? (
            <MediaImageBubble
              message={headerMediaMessage}
              onOpen={openHeaderMedia}
              t={t}
              fullWidth
            />
          ) : display?.header_type === "video" ? (
            <MediaVideoBubble
              message={headerMediaMessage}
              onOpen={openHeaderMedia}
              t={t}
              fullWidth
            />
          ) : (
            <MediaDocumentBubble message={headerMediaMessage} t={t} />
          )}
        </div>
      )}
      {isMediaHeaderType(display?.header_type) && !headerMediaUrl && (
        <div className="mb-2">
          <MediaUnavailable
            label={
              display?.header_type === "image"
                ? t("photo")
                : display?.header_type === "video"
                  ? t("video")
                  : t("document")
            }
            t={t}
          />
        </div>
      )}
      <span className="mb-1 inline-flex items-center gap-1 rounded bg-black/15 px-1.5 py-0.5 text-[10px] font-medium opacity-90">
        <LayoutTemplate className="h-3 w-3" />
        {t("template")}
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
  t,
  isAgent,
  onOpenMedia,
  templateDisplay,
}: {
  message: Message;
  t: ReturnType<typeof useTranslations>;
  /** Outbound bubbles sit on the primary fill — badges must invert. */
  isAgent: boolean;
  onOpenMedia?: (messageId: string) => void;
  templateDisplay?: TemplateMessageSnapshot | null;
}) {
  const openMedia = onOpenMedia ? () => onOpenMedia(message.id) : undefined;

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
            <MediaImageBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("photo")} t={t} />
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
            <MediaVideoBubble message={message} onOpen={openMedia} t={t} />
          ) : (
            <MediaUnavailable label={t("video")} t={t} />
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
            <MediaAudioBubble message={message} t={t} />
          ) : (
            <MediaUnavailable label={t("audio")} t={t} />
          )}
        </div>
      );

    case "document":
      if (!message.media_url) {
        return (
          <MediaUnavailable
            label={message.content_text || t("document")}
            t={t}
          />
        );
      }
      return <MediaDocumentBubble message={message} t={t} />;

    case "template":
      return (
        <TemplateMessageContent
          message={message}
          display={templateDisplay ?? null}
          onPrimary={isAgent}
          t={t}
          onOpenMedia={onOpenMedia}
        />
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span>{message.content_text || t("locationShared")}</span>
        </div>
      );

    case "interactive": {
      const payload = message.content_payload as
        | {
            type?: string;
            flow_cta?: string;
            product_title?: string;
            checkout_url?: string;
            button_label?: string;
            price?: string;
            currency?: string | null;
            image_url?: string | null;
          }
        | null
        | undefined;

      if (payload?.type === "product_card") {
        const priceLabel =
          payload.price && payload.currency === "INR"
            ? `₹${payload.price}`
            : payload.price && payload.currency
              ? `${payload.currency} ${payload.price}`
              : payload.price ?? null;

        return (
          <div className="flex max-w-xs flex-col gap-2">
            {payload.image_url || message.media_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={payload.image_url || message.media_url || ""}
                alt=""
                className="max-h-40 w-full rounded-md object-cover"
              />
            ) : null}
            {message.content_text ? (
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                {message.content_text}
              </p>
            ) : (
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {payload.product_title || "Product"}
                </p>
                {priceLabel ? (
                  <p className="text-xs text-muted-foreground">{priceLabel}</p>
                ) : null}
              </div>
            )}
            <span className="inline-flex w-fit rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              {payload.button_label || "Buy now"}
            </span>
          </div>
        );
      }

      const isFlowRequest = payload?.type === "whatsapp_flow_request";
      if (isFlowRequest) {
        return (
          <div className="flex flex-col gap-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="h-3 w-3" />
              WhatsApp Flow
            </span>
            {message.content_text ? (
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.content_text}
              </p>
            ) : null}
            {payload?.flow_cta ? (
              <span className="mt-1 inline-flex w-fit rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                {payload.flow_cta}
              </span>
            ) : null}
          </div>
        );
      }

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

      if (message.interactive_payload) {
        return <InteractivePreview payload={message.interactive_payload} />;
      }

      const isFlowForm =
        message.interactive_reply_id === "flow" ||
        (message.content_payload &&
          (message.content_payload as { type?: string }).type ===
            "whatsapp_flow");
      if (isFlowForm) {
        const values =
          ((message.content_payload as { values?: Record<string, string> })
            ?.values as Record<string, string> | undefined) ?? {};
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <ClipboardList className="h-3 w-3" />
              Form submission
            </span>
            {message.content_text ? (
              <p className="whitespace-pre-wrap break-words text-sm">
                {message.content_text}
              </p>
            ) : null}
            <FormSubmissionFields values={values} compact />
          </div>
        );
      }

      if (message.sender_type === "customer") {
        return (
          <div className="flex flex-col gap-0.5">
            <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <CornerDownLeft className="h-3 w-3" />
              {t("buttonReply")}
            </span>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text || t("interactiveReply")}
            </p>
          </div>
        );
      }

      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("interactiveReply")}
        </p>
      );
    }

    default:
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text || t("unsupported")}
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
  onOpenMedia,
}: MessageBubbleProps) {
  const t = useTranslations("Inbox.bubble");
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

  const isAgent =
    message.sender_type === "agent" || message.sender_type === "bot";

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
          t={t}
          isAgent={isAgent}
          onOpenMedia={onOpenMedia}
          templateDisplay={templateDisplay}
        />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          {message.ai_generated && (
            <span
              className="inline-flex items-center gap-0.5 rounded-full bg-primary-foreground/20 px-1.5 py-px text-[9px] font-semibold uppercase leading-none tracking-wide text-primary-foreground"
              title={t("aiBadgeTitle")}
            >
              <Sparkles className="h-2.5 w-2.5" />
              {t("aiBadge")}
            </span>
          )}
          <span
            className={cn(
              "text-[10px]",
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
