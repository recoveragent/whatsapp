import { describe, it, expect } from "vitest";
import type { ContentType, Message, SenderType } from "@/types";
import { collectMediaGallery, galleryIndexOf } from "./gallery";

function msg(
  id: string,
  content_type: ContentType,
  overrides: Partial<Message> = {},
): Message {
  return {
    id,
    conversation_id: "conv-1",
    sender_type: (overrides.sender_type ?? "customer") as SenderType,
    content_type,
    status: "delivered",
    created_at: "2026-08-04T10:00:00.000Z",
    ...overrides,
  };
}

describe("collectMediaGallery", () => {
  it("keeps images and videos in thread order and nothing else", () => {
    const items = collectMediaGallery([
      msg("t1", "text", { content_text: "hi" }),
      msg("i1", "image", { media_url: "/api/whatsapp/media/1" }),
      msg("a1", "audio", { media_url: "/api/whatsapp/media/2" }),
      msg("v1", "video", { media_url: "/api/whatsapp/media/3" }),
      msg("d1", "document", { media_url: "/api/whatsapp/media/4" }),
      msg("i2", "image", { media_url: "https://x.supabase.co/photo.png" }),
    ]);

    expect(items.map((i) => i.messageId)).toEqual(["i1", "v1", "i2"]);
    expect(items.map((i) => i.kind)).toEqual(["image", "video", "image"]);
  });

  it("skips media whose bytes we have no URL for", () => {
    // Meta refusing to verify the id (webhook's verifyAndBuildUrl → null) or
    // expiring it later both land here — the bubble shows "unavailable", so
    // the viewer must not offer a blank frame to page onto.
    const items = collectMediaGallery([
      msg("i1", "image"),
      msg("i2", "image", { media_url: "" }),
      msg("i3", "image", { media_url: "/api/whatsapp/media/9" }),
    ]);
    expect(items.map((i) => i.messageId)).toEqual(["i3"]);
  });

  it("carries the caption, direction and the row itself", () => {
    const [item] = collectMediaGallery([
      msg("i1", "image", {
        media_url: "/api/whatsapp/media/1",
        content_text: "the receipt",
        sender_type: "agent",
      }),
    ]);

    expect(item.caption).toBe("the receipt");
    expect(item.fromCustomer).toBe(false);
    expect(item.message.id).toBe("i1");
  });

  it("treats an empty caption as no caption", () => {
    const [item] = collectMediaGallery([
      msg("i1", "image", { media_url: "/api/whatsapp/media/1", content_text: "" }),
    ]);
    expect(item.caption).toBeUndefined();
  });

  it("counts a bot-sent image as ours, not the customer's", () => {
    const [item] = collectMediaGallery([
      msg("i1", "image", {
        media_url: "/api/whatsapp/media/1",
        sender_type: "bot",
      }),
    ]);
    expect(item.fromCustomer).toBe(false);
  });

  it("returns nothing for a thread with no media", () => {
    expect(collectMediaGallery([msg("t1", "text")])).toEqual([]);
    expect(collectMediaGallery([])).toEqual([]);
  });
});

describe("template media", () => {
  it("opens snapshot images with a downloadable media row", () => {
    const [item] = collectMediaGallery([msg("template-1", "template", {
      content_payload: { template_display: { header_type: "image", header_media_url: "https://example.com/header.jpg" } },
    })]);
    expect(item.url).toBe("https://example.com/header.jpg");
    expect(item.message.content_type).toBe("image");
    expect(item.message.media_url).toBe(item.url);
    expect(galleryIndexOf([item], "template-1")).toBe(0);
  });

  it("uses resolved legacy headers and falls back to the message media URL", () => {
    const items = collectMediaGallery([
      msg("legacy", "template", { media_url: "https://example.com/video.mp4" }),
      msg("document", "template"),
    ], (message) => ({ header_type: message.id === "legacy" ? "video" : "document" }));
    expect(items.map((item) => [item.messageId, item.kind, item.url])).toEqual([
      ["legacy", "video", "https://example.com/video.mp4"],
    ]);
  });
});

describe("galleryIndexOf", () => {
  const items = collectMediaGallery([
    msg("i1", "image", { media_url: "/api/whatsapp/media/1" }),
    msg("i2", "image", { media_url: "/api/whatsapp/media/2" }),
  ]);

  it("finds the open item", () => {
    expect(galleryIndexOf(items, "i2")).toBe(1);
  });

  it("reports -1 for null, so a closed viewer stays closed", () => {
    expect(galleryIndexOf(items, null)).toBe(-1);
  });

  it("reports -1 once the message is gone from the thread", () => {
    // Happens when an optimistic `temp-…` bubble is swapped for its real row
    // while the viewer is open — the viewer closes rather than mis-pointing.
    expect(galleryIndexOf(items, "temp-123")).toBe(-1);
  });
});
