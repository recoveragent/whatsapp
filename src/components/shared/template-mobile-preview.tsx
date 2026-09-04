"use client";

import { Copy, ExternalLink, Phone } from "lucide-react";

import { cn } from "@/lib/utils";
import { isMediaHeaderType } from "@/lib/inbox/template-message-display";
import type { TemplateButton } from "@/types";

interface TemplateMobilePreviewProps {
  bodyText: string;
  headerType?: "text" | "image" | "video" | "document" | null;
  headerContent?: string | null;
  headerMediaUrl?: string | null;
  footerText?: string | null;
  buttons?: TemplateButton[];
  /** Shown in the WhatsApp-style chat header. */
  businessName?: string;
  className?: string;
}

function PreviewButton({ button }: { button: TemplateButton }) {
  const iconClass = "h-3.5 w-3.5 shrink-0 text-[#008069]";

  let icon = null;
  if (button.type === "PHONE_NUMBER") icon = <Phone className={iconClass} />;
  else if (button.type === "URL") icon = <ExternalLink className={iconClass} />;
  else if (button.type === "COPY_CODE") icon = <Copy className={iconClass} />;

  return (
    <div className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-center text-[13px] font-medium text-[#008069]">
      {icon}
      <span>{button.text}</span>
    </div>
  );
}

export function TemplateMobilePreview({
  bodyText,
  headerType,
  headerContent,
  headerMediaUrl,
  footerText,
  buttons = [],
  businessName = "Your business",
  className,
}: TemplateMobilePreviewProps) {
  const quickReplies = buttons.filter((b) => b.type === "QUICK_REPLY");
  const inlineButtons = buttons.filter((b) => b.type !== "QUICK_REPLY");
  const mediaUrl = headerMediaUrl?.trim() || null;

  return (
    <div
      className={cn(
        "mx-auto w-full max-w-[280px] overflow-hidden rounded-[28px] border-[3px] border-zinc-800 bg-zinc-900 shadow-lg",
        className,
      )}
    >
      {/* Status bar */}
      <div className="flex items-center justify-between bg-zinc-900 px-5 py-1.5">
        <span className="text-[10px] font-medium text-zinc-300">9:41</span>
        <div className="h-5 w-[72px] rounded-full bg-zinc-800" aria-hidden />
        <div className="flex items-center gap-1" aria-hidden>
          <div className="h-2.5 w-2.5 rounded-sm bg-zinc-400" />
          <div className="h-2.5 w-3.5 rounded-sm bg-zinc-400" />
        </div>
      </div>

      {/* WhatsApp chat header */}
      <div className="flex items-center gap-2 bg-[#075E54] px-3 py-2.5">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-[11px] font-semibold text-white"
          aria-hidden
        >
          {businessName.charAt(0).toUpperCase()}
        </div>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-white">
          {businessName}
        </p>
      </div>

      {/* Chat wallpaper */}
      <div
        className="min-h-[220px] bg-[#ECE5DD] px-2.5 py-3"
        style={{
          backgroundImage:
            "radial-gradient(circle at 20% 30%, rgba(0,0,0,0.03) 1px, transparent 1px), radial-gradient(circle at 80% 70%, rgba(0,0,0,0.03) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      >
        <div className="max-w-[92%] overflow-hidden rounded-lg rounded-tl-none bg-white shadow-sm">
          {headerType === "text" && headerContent && (
            <p className="px-2.5 pt-2 text-[14px] font-semibold leading-snug text-zinc-900">
              {headerContent}
            </p>
          )}

          {isMediaHeaderType(headerType) && mediaUrl && headerType === "image" && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={mediaUrl}
              alt="Template header"
              className="block w-full max-h-36 object-cover"
            />
          )}

          {isMediaHeaderType(headerType) && !mediaUrl && (
            <div className="flex h-28 items-center justify-center bg-zinc-100 text-[11px] text-zinc-400">
              {headerType === "image"
                ? "Image header"
                : headerType === "video"
                  ? "Video header"
                  : "Document header"}
            </div>
          )}

          {isMediaHeaderType(headerType) &&
            mediaUrl &&
            headerType !== "image" && (
              <div className="flex h-16 items-center justify-center bg-zinc-100 text-[11px] text-zinc-500">
                {headerType === "video" ? "Video preview" : "Document preview"}
              </div>
            )}

          <div className="px-2.5 py-2">
            <p className="whitespace-pre-wrap break-words text-[14px] leading-snug text-zinc-900">
              {bodyText}
            </p>
            {footerText && (
              <p className="mt-1.5 text-[11px] text-zinc-500">{footerText}</p>
            )}
            <p className="mt-1 text-right text-[10px] text-zinc-400">9:41</p>
          </div>

          {inlineButtons.length > 0 && (
            <div className="border-t border-zinc-200">
              {inlineButtons.map((button, index) => (
                <div
                  key={`${button.type}-${button.text}-${index}`}
                  className={cn(index > 0 && "border-t border-zinc-200")}
                >
                  <PreviewButton button={button} />
                </div>
              ))}
            </div>
          )}
        </div>

        {quickReplies.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {quickReplies.map((button) => (
              <div
                key={button.text}
                className="rounded-full border border-[#008069]/30 bg-white px-3 py-1.5 text-[12px] font-medium text-[#008069] shadow-sm"
              >
                {button.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
