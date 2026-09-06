"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { buildEmbedInboxUrl } from "@/lib/embed/query";
import {
  isRecoverAgentEmbedMessage,
  isRecoverAgentEmbedParentOrigin,
} from "@/lib/embed/recover-agent";
import { pickValidE164Phone } from "@/lib/whatsapp/phone-utils";

/**
 * Listen for Recover Agent dashboard postMessage commands while the inbox
 * is embedded (`?embed=1`). Parent can push a new `?phone=` to switch chats.
 */
export function useRecoverAgentEmbed(enabled: boolean) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;

    const onMessage = (event: MessageEvent) => {
      if (!isRecoverAgentEmbedParentOrigin(event.origin)) return;
      if (!isRecoverAgentEmbedMessage(event.data)) return;
      if (event.data.action !== "open") return;

      const phone = pickValidE164Phone([event.data.phone]);
      if (!phone) return;

      router.replace(buildEmbedInboxUrl({ phone }), { scroll: false });
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [enabled, router]);
}
