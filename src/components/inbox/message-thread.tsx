"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { usePresence } from "@/hooks/use-presence";
import { PresenceDot } from "@/components/presence/presence-dot";
import { presenceLabel } from "@/lib/presence";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
  ConversationPrivateNote,
} from "@/types";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  PanelRightOpen,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ContactSidebar } from "@/components/inbox/contact-sidebar";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { MessageBubble } from "./message-bubble";
import { MessageActions } from "./message-actions";
import {
  MessageComposer,
  CHAT_MEDIA_BUCKET,
  type SendMediaPayload,
} from "./message-composer";
import { deleteAccountMedia } from "@/lib/storage/upload-media";
import { TemplatePicker } from "./template-picker";
import { FlowPicker, type ManualFlowOption } from "./flow-picker";
import { PrivateNoteBubble } from "./private-note-bubble";
import { buildReplyPreview } from "./reply-quote";
import {
  buildTemplateMessageSnapshot,
  resolveTemplateMessageDisplay,
  templateDisplayPayload,
} from "@/lib/inbox/template-message-display";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onPatchStatus: (status: ConversationStatus) => Promise<void>;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Desktop-only contact-panel toggle. The page owns the open/closed
   * state (it's the one that renders the sidebar), so the thread just
   * reflects it and asks the page to flip it. Both optional so existing
   * callers keep working; the toggle button only renders when
   * `onToggleContactPanel` is wired up.
   */
  contactPanelOpen?: boolean;
  onToggleContactPanel?: () => void;
  /** Opens the desktop contact panel without toggling closed. */
  onOpenContactPanel?: () => void;
  /** Fired when the agent clicks the contact name/avatar in the header. */
  onOpenContact?: () => void;
  /** Parent uses this to block leaving the thread while a send is in flight. */
  onComposerPendingChange?: (pending: boolean) => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

type TimelineItem =
  | { kind: "message"; created_at: string; message: Message }
  | { kind: "note"; created_at: string; note: ConversationPrivateNote };

function buildTimeline(messages: Message[], notes: ConversationPrivateNote[]): TimelineItem[] {
  const items: TimelineItem[] = [
    ...messages.map((message) => ({
      kind: "message" as const,
      created_at: message.created_at,
      message,
    })),
    ...notes.map((note) => ({
      kind: "note" as const,
      created_at: note.created_at,
      note,
    })),
  ];

  return items.sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
}

function groupTimelineByDate(items: TimelineItem[]) {
  const groups: { date: string; items: TimelineItem[] }[] = [];
  let currentDate = "";

  for (const item of items) {
    const day = format(new Date(item.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: item.created_at, items: [item] });
    } else {
      groups[groups.length - 1].items.push(item);
    }
  }

  return groups;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "text-primary",
  pending: "text-amber-400",
  closed: "text-muted-foreground",
  followup: "text-amber-500",
};

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-background bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onPatchStatus,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  contactPanelOpen,
  onToggleContactPanel,
  onOpenContactPanel,
  onOpenContact,
  onComposerPendingChange,
}: MessageThreadProps) {
  const { user, accountId } = useAuth();
  const { getPresence, getRow, now } = usePresence();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [flowModalOpen, setFlowModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [contactSheetOpen, setContactSheetOpen] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);
  const handleOpenContact = useCallback(() => {
    onOpenContact?.();

    if (
      typeof window !== "undefined" &&
      !window.matchMedia("(min-width: 1024px)").matches
    ) {
      setContactSheetOpen(true);
    }
  }, [onOpenContact]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(
    null,
  );
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [privateNotes, setPrivateNotes] = useState<ConversationPrivateNote[]>([]);
  const [selfAssigning, setSelfAssigning] = useState(false);
  const [templatesByName, setTemplatesByName] = useState<
    Map<string, MessageTemplate>
  >(new Map());

  const fetchPrivateNotes = useCallback(async (convId: string) => {
    try {
      const res = await fetch(`/api/inbox/conversations/${convId}/private-notes`);
      if (res.ok) {
        const data = (await res.json()) as { notes?: ConversationPrivateNote[] };
        setPrivateNotes(data.notes ?? []);
      } else {
        setPrivateNotes([]);
      }
    } catch {
      setPrivateNotes([]);
    }
  }, []);

  const handlePrivateNoteSaved = useCallback((note: ConversationPrivateNote) => {
    setPrivateNotes((prev) => {
      const next = [...prev.filter((n) => n.id !== note.id), note];
      return next.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
      );
    });
  }, []);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountId) {
      setTemplatesByName(new Map());
      return;
    }

    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("message_templates")
      .select("*")
      .eq("account_id", accountId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch templates:", error);
          setTemplatesByName(new Map());
          return;
        }
        const map = new Map<string, MessageTemplate>();
        for (const row of (data as MessageTemplate[]) ?? []) {
          if (!map.has(row.name)) map.set(row.name, row);
        }
        setTemplatesByName(map);
      });

    return () => {
      cancelled = true;
    };
  }, [accountId]);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (!messages.length) return { expired: false, remaining: "" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: true, remaining: "No customer messages" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expired" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) return;

    const supabase = createClient();
    let cancelled = false;

    (async () => {
      setLoading(true);

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        let rows = data ?? [];
        const missingOutboundOnly =
          rows.length > 0 &&
          rows.every((m) => m.sender_type === "customer");
        if (missingOutboundOnly) {
          try {
            const res = await fetch(
              `/api/inbox/conversations/${conversationId}/repair-flow-prompt`,
              { method: "POST" },
            );
            if (res.ok) {
              const body = (await res.json()) as { repaired?: boolean };
              if (body.repaired) {
                const { data: refetched } = await supabase
                  .from("messages")
                  .select("*")
                  .eq("conversation_id", conversationId)
                  .order("created_at", { ascending: true });
                if (refetched?.length) rows = refetched;
              }
            }
          } catch (repairErr) {
            console.warn("[inbox] repair flow prompt failed:", repairErr);
          }
        }
        onMessagesLoadedRef.current(rows);
      }

      if (!cancelled) setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
    setHighlightedMessageId(null);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    if (!conversationId) {
      setPrivateNotes([]);
      return;
    }
    void fetchPrivateNotes(conversationId);
  }, [conversationId, resyncToken, fetchPrivateNotes]);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .then(({ error }) => {
        if (error) console.error("Failed to reset unread_count:", error);
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages or private notes
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, privateNotes]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send message:", reason);
          toast.error(`Failed to send: ${reason}`);
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed", error_message: reason });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed", error_message: reason });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  const handleSendMedia = useCallback(
    async (payload: SendMediaPayload) => {
      if (!conversation) return;

      // Documents show their filename in our own bubble (and to the
      // recipient as the Meta caption when no caption was typed); other
      // kinds use the caption as-is. Audio carries no caption.
      const contentText =
        payload.kind === "document"
          ? payload.caption || payload.filename || "Document"
          : payload.caption;

      const tempId = `temp-${Date.now()}`;
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: payload.kind,
        content_text: contentText,
        media_url: payload.mediaUrl,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: payload.replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: payload.kind,
            media_url: payload.mediaUrl,
            content_text: contentText,
            filename: payload.filename,
            reply_to_message_id: payload.replyToId,
          }),
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = data?.error || `HTTP ${res.status}`;
          console.error("Failed to send media:", reason);
          toast.error(`Failed to send: ${reason}`);
          onUpdateMessage(tempId, { status: "failed", error_message: reason });
          // The upload never reached the recipient — GC the orphaned
          // object rather than leaving it in the public bucket forever.
          void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send media:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed", error_message: reason });
        void deleteAccountMedia(CHAT_MEDIA_BUCKET, payload.path).catch(() => {});
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;
      await onPatchStatus(status);
    },
    [conversation, onPatchStatus],
  );

  const handleToggleOpenClose = useCallback(() => {
    if (!conversation) return;
    const next: ConversationStatus =
      conversation.status === "closed" ? "open" : "closed";
    void handleStatusChange(next);
  }, [conversation, handleStatusChange]);

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleOpenFlows = useCallback(() => {
    setFlowModalOpen(true);
  }, []);

  const handleStartFlow = useCallback(
    async (flow: ManualFlowOption) => {
      if (!conversation) return;

      try {
        const res = await fetch(`/api/flows/${flow.id}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversation.id }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to start flow:", reason);
          toast.error(`Failed to start flow: ${reason}`);
          return;
        }

        toast.success(`Started "${flow.name}"`);
        onRefresh?.();
      } catch (err) {
        console.error("Failed to start flow:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to start flow: ${reason}`);
      }
    },
    [conversation, onRefresh],
  );

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;
      const templateSnapshot = buildTemplateMessageSnapshot(template, {
        headerText: values.headerText,
        buttonParams: values.buttonParams,
      });

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        sender_id: user?.id,
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        content_payload: templateDisplayPayload(templateSnapshot),
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          console.error("Failed to send template:", reason);
          toast.error(`Failed to send template: ${reason}`);
          onUpdateMessage(tempId, { status: "failed", error_message: reason });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed", error_message: reason });
      }
    },
    [conversation, onNewMessage, onUpdateMessage, user?.id],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const displayNameForUser = useCallback(
    (userId: string): string | null => {
      const profile = profiles.find((p) => p.user_id === userId);
      if (profile?.full_name?.trim()) return profile.full_name.trim();
      if (profile?.email?.trim()) {
        const email = profile.email.trim();
        return email.split("@")[0] || email;
      }
      return null;
    },
    [profiles],
  );

  const senderLabelFor = useCallback(
    (m: Message): string => {
      if (m.sender_type === "customer") return contactDisplayName;
      if (m.sender_type === "bot") return "Automation";
      if (m.sender_id) {
        const name = displayNameForUser(m.sender_id);
        if (name) return name;
      }
      if (m.sender_type === "agent" && user?.id) {
        const name = displayNameForUser(user.id);
        if (name) return name;
      }
      return "Agent";
    },
    [contactDisplayName, displayNameForUser, user?.id],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  const handleJumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedMessageId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedMessageId(null);
      highlightTimerRef.current = null;
    }, 1600);
  }, []);

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      const res = await fetch(`/api/inbox/conversations/${conversation.id}/assign`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_agent_id: agentId }),
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        console.error("Failed to update assignment:", body?.error);
        toast.error(body?.error ?? "Failed to update assignment");
        return;
      }

      const updated = (await res.json()) as Conversation & {
        system_message?: Message | null;
      };
      onAssignChange(conversation.id, updated.assigned_agent_id ?? null);
      if (updated.system_message) {
        onNewMessage(updated.system_message);
      }

      if (agentId && contact?.id && accountId) {
        void fetch("/api/crm/triggers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trigger_type: "conversation_assigned",
            contact_id: contact.id,
            conversation_id: conversation.id,
            agent_id: agentId,
          }),
        });
      }
    },
    [conversation, contact, accountId, onAssignChange, onNewMessage],
  );

  const handleSelfAssign = useCallback(async () => {
    if (!user?.id) return;
    setSelfAssigning(true);
    try {
      await handleAssignChange(user.id);
    } finally {
      setSelfAssigning(false);
    }
  }, [user?.id, handleAssignChange]);

  const timeline = useMemo(
    () => buildTimeline(messages, privateNotes),
    [messages, privateNotes],
  );
  const timelineGroups = groupTimelineByDate(timeline);

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center", DOODLE_BG_CLASSES)}>
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <MessageSquare className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-sm font-medium text-muted-foreground">
          Select a conversation
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a conversation from the left to start messaging
        </p>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const isClosed = conversation.status === "closed";
  const primaryStatusLabel = isClosed ? "Open" : "Close";
  const primaryStatusColor = isClosed
    ? STATUS_COLORS.open
    : STATUS_COLORS[conversation.status] ?? STATUS_COLORS.open;
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";

  return (
    // `min-w-0` is load-bearing: the page already puts min-w-0 on the
    // thread's flex *wrapper* (issue #165), but this root keeps the
    // default `min-width: auto`, so a single wide message (long unbroken
    // URL/word) expands the whole thread past its flex share and the chat
    // paints on top of the contact sidebar at lg+ — outgoing bubbles get
    // clipped and the hover toolbar overlaps the Tags panel. Letting the
    // root shrink lets the bubbles' break-words / max-w caps apply.
    // Issue #257.
    <div className={cn("flex min-w-0 flex-1 flex-col", DOODLE_BG_CLASSES)}>
      {/* Header — solid card surface sits on top of the doodle so the
          name/avatar/dropdowns stay legible. */}
      <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={handleOpenContact}
            className="group relative z-10 flex min-w-0 cursor-pointer items-center gap-2 rounded-md text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:gap-3 -ml-1 pl-1 pr-2 py-0.5"
            aria-label={`Open contact details for ${displayName}`}
            title="Open contact"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 pointer-events-none">
              <h2 className="truncate text-sm font-semibold text-foreground underline-offset-2 group-hover:underline">
                {displayName}
              </h2>
              <p className="truncate text-xs text-muted-foreground">
                {contact.phone}
              </p>
            </div>
          </button>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. */}
          <Badge
            variant="outline"
            className={cn(
              "ml-1 hidden shrink-0 gap-1 border-border text-[10px] sm:inline-flex sm:ml-2",
              sessionInfo.expired ? "text-red-400" : "text-primary"
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {/* Show contact panel — desktop only, when the sidebar is
              collapsed. The hide control lives in the sidebar header.
              Issue #258. */}
          {!contactPanelOpen && onToggleContactPanel && (
            <button
              type="button"
              onClick={onToggleContactPanel}
              aria-label="Show contact panel"
              aria-pressed={false}
              title="Show contact"
              className="hidden h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:inline-flex"
            >
              <PanelRightOpen className="h-4 w-4" />
            </button>
          )}

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Status: primary toggles open/closed; dropdown sets follow-up */}
          <div className="inline-flex items-center rounded-md border border-border">
            <button
              type="button"
              onClick={handleToggleOpenClose}
              className={cn(
                "inline-flex h-7 items-center px-2.5 text-xs font-medium hover:bg-muted",
                primaryStatusColor,
              )}
            >
              {primaryStatusLabel}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center border-l border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                  conversation.status === "followup" && "text-amber-500",
                )}
                aria-label="More status options"
              >
                <ChevronDown className="h-3 w-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="border-border bg-popover"
              >
                <DropdownMenuItem
                  onClick={() => void handleStatusChange("followup")}
                  className={cn("text-sm", STATUS_COLORS.followup)}
                >
                  Followup
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-muted",
                assignedAgentId ? "text-primary" : "text-muted-foreground"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-muted-foreground">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  const presence = getPresence(p.user_id);
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-popover-foreground"
                      )}
                    >
                      <PresenceDot
                        status={presence}
                        label={presenceLabel(
                          presence,
                          getRow(p.user_id)?.last_seen_at ?? null,
                          now
                        )}
                        className="mr-2"
                      />
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-border" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-muted-foreground"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : timeline.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-muted-foreground">No messages yet</p>
            <p className="text-xs text-muted-foreground">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {timelineGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-muted px-3 py-1 text-[10px] font-medium text-muted-foreground">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                <div className="space-y-2">
                  {group.items.map((item) => {
                    if (item.kind === "note") {
                      return <PrivateNoteBubble key={`note-${item.note.id}`} note={item.note} />;
                    }

                    const msg = item.message;
                    if (msg.content_type === "system") {
                      return <MessageBubble key={msg.id} message={msg} />;
                    }

                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        highlighted={highlightedMessageId === msg.id}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          onReplyClick={
                            parent
                              ? () => handleJumpToMessage(parent.id)
                              : undefined
                          }
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                          senderLabel={senderLabelFor(msg)}
                          templateDisplay={
                            msg.content_type === "template"
                              ? resolveTemplateMessageDisplay(
                                  msg,
                                  msg.template_name
                                    ? templatesByName.get(msg.template_name)
                                    : null,
                                )
                              : null
                          }
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendMedia={handleSendMedia}
        onOpenTemplates={handleOpenTemplates}
        onOpenFlows={handleOpenFlows}
        onPrivateNoteSaved={handlePrivateNoteSaved}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        onComposerPendingChange={onComposerPendingChange}
        assignedAgentId={assignedAgentId}
        currentUserId={user?.id ?? null}
        assigneeName={currentAssignee?.full_name ?? null}
        onSelfAssign={handleSelfAssign}
        selfAssigning={selfAssigning}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      <FlowPicker
        open={flowModalOpen}
        onOpenChange={setFlowModalOpen}
        onSelect={handleStartFlow}
      />

      {/* Mobile contact details — desktop uses the permanent sidebar. */}
      <Sheet open={contactSheetOpen} onOpenChange={setContactSheetOpen}>
        <SheetContent side="right" className="w-full max-w-sm p-0">
          <SheetHeader className="sr-only">
            <SheetTitle>{displayName}</SheetTitle>
          </SheetHeader>
          <ContactSidebar
            contact={contact}
            conversationId={conversation.id}
          />
        </SheetContent>
      </Sheet>

    </div>
  );
}
