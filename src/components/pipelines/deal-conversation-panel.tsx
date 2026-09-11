"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { MessageThread } from "@/components/inbox/message-thread";
import { useRealtime } from "@/hooks/use-realtime";
import { createClient } from "@/lib/supabase/client";
import type {
  Contact,
  Conversation,
  ConversationStatus,
  Message,
} from "@/types";

type RealtimeEvent<T> = {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
};

export function DealConversationPanel({
  contactId,
  initialContact,
  onBack,
}: {
  contactId: string;
  initialContact?: Contact | null;
  onBack: () => void;
}) {
  const supabase = createClient();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [contact, setContact] = useState<Contact | null>(initialContact ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [resyncToken, setResyncToken] = useState(0);
  const conversationIdRef = useRef<string | null>(null);

  useEffect(() => {
    conversationIdRef.current = conversation?.id ?? null;
  }, [conversation?.id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMessages([]);

    (async () => {
      const [conversationRes, contactRes] = await Promise.all([
        supabase
          .from("conversations")
          .select("*, contact:contacts(*)")
          .eq("contact_id", contactId)
          .order("last_message_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        initialContact
          ? Promise.resolve({ data: initialContact, error: null })
          : supabase.from("contacts").select("*").eq("id", contactId).maybeSingle(),
      ]);

      if (cancelled) return;

      const loadedConversation =
        (conversationRes.data as Conversation | null) ?? null;
      setConversation(loadedConversation);
      setContact(
        (contactRes.data as Contact | null) ??
          loadedConversation?.contact ??
          initialContact ??
          null,
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId, initialContact, supabase]);

  const handleMessageEvent = useCallback((event: RealtimeEvent<Message>) => {
    const activeConversationId = conversationIdRef.current;
    if (!activeConversationId) return;

    const newMsg = event.new;
    if (newMsg.conversation_id !== activeConversationId) return;

    if (event.eventType === "INSERT") {
      setMessages((prev) => {
        if (prev.some((message) => message.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      setConversation((prev) =>
        prev
          ? {
              ...prev,
              last_message_at: newMsg.created_at,
              last_message_text: newMsg.content_text ?? prev.last_message_text,
            }
          : prev,
      );
      return;
    }

    if (event.eventType === "UPDATE") {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === newMsg.id ? { ...message, ...newMsg } : message,
        ),
      );
    }
  }, []);

  const handleConversationEvent = useCallback(
    (event: RealtimeEvent<Conversation>) => {
      const activeConversationId = conversationIdRef.current;
      if (!activeConversationId || event.new.id !== activeConversationId) return;

      if (event.eventType === "UPDATE") {
        setConversation((prev) => (prev ? { ...prev, ...event.new } : prev));
      }
    },
    [],
  );

  useRealtime({
    channelName: `deal-conversation-${contactId}`,
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
  });

  const handleMessagesLoaded = useCallback((loaded: Message[]) => {
    setMessages(loaded);
  }, []);

  const handleNewMessage = useCallback((message: Message) => {
    setMessages((prev) => {
      if (prev.some((item) => item.id === message.id)) return prev;
      return [...prev, message];
    });
  }, []);

  const handleUpdateMessage = useCallback(
    (id: string, updates: Partial<Message>) => {
      setMessages((prev) =>
        prev.map((message) =>
          message.id === id ? { ...message, ...updates } : message,
        ),
      );
    },
    [],
  );

  const handlePatchStatus = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const res = await fetch(
        `/api/inbox/conversations/${conversation.id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
        } | null;
        toast.error(body?.error ?? "Failed to update conversation status");
        return;
      }

      const updated = (await res.json()) as Conversation & {
        system_message?: Message | null;
      };
      setConversation((prev) => (prev ? { ...prev, ...updated } : prev));
      if (updated.system_message) {
        handleNewMessage(updated.system_message);
      }
      if (updated.status === "followup") {
        toast.success("Follow-up scheduled");
      }
    },
    [conversation, handleNewMessage],
  );

  const handleAssignChange = useCallback(
    (_conversationId: string, assignedAgentId: string | null) => {
      setConversation((prev) =>
        prev
          ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
          : prev,
      );
    },
    [],
  );

  const handleRefresh = useCallback(() => {
    setResyncToken((value) => value + 1);
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-sm text-muted-foreground">
        Loading conversation…
      </div>
    );
  }

  if (!conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm text-muted-foreground">
          No WhatsApp conversation exists for this contact yet.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="text-sm font-medium text-primary hover:text-primary/80"
        >
          Back to deal
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <MessageThread
        conversation={conversation}
        contact={contact}
        messages={messages}
        onMessagesLoaded={handleMessagesLoaded}
        onNewMessage={handleNewMessage}
        onUpdateMessage={handleUpdateMessage}
        onPatchStatus={handlePatchStatus}
        onAssignChange={handleAssignChange}
        onBack={onBack}
        showBackAlways
        resyncToken={resyncToken}
        onRefresh={handleRefresh}
      />
    </div>
  );
}
