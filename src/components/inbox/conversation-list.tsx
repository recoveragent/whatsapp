"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, ChevronDown, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { NewMessageDialog } from "@/components/inbox/new-message-dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  shouldShowInInboxList,
  matchesInboxSearch,
  filterInboxConversations,
  sortInboxConversations,
  getInboxActivityAt,
  type InboxFilter,
  type InboxSortOrder,
} from "@/lib/inbox/conversation-list";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  /**
   * Increment to force the fetch effect below to refire. The parent
   * bumps this on realtime reconnect / tab visibility → visible so the
   * list catches up on any events sent while the WS was disconnected
   * or the tab was throttled. Optional so existing callers keep working.
   */
  resyncToken?: number;
  /** Called when the agent starts a new conversation from the dialog. */
  onConversationCreated?: (conversation: Conversation) => void;
  /** Reports the sidebar filter/search/sort so the parent can pick the next thread. */
  onListViewChange?: (view: {
    filter: InboxFilter;
    search: string;
    sort: InboxSortOrder;
  }) => void;
}

const STATUS_COLORS: Record<ConversationStatus, string> = {
  open: "bg-primary",
  pending: "bg-amber-500",
  closed: "bg-muted-foreground",
  followup: "bg-amber-500",
};

const SORT_OPTIONS: { label: string; value: InboxSortOrder }[] = [
  { label: "Newest", value: "newest" },
  { label: "Oldest", value: "oldest" },
];

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  onConversationCreated,
  onListViewChange,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");

  const PRIMARY_FILTERS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      { label: t("filterOpen"), value: "open" },
      { label: t("filterClosed"), value: "closed" },
    ],
    [t],
  );

  const OTHER_FILTERS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      { label: "Followup", value: "followup" },
      { label: t("filterPending"), value: "pending" },
      { label: t("filterUnread"), value: "unread" },
      { label: t("filterAll"), value: "all" },
    ],
    [t],
  );

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("open");
  const [sort, setSort] = useState<InboxSortOrder>("newest");
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  useEffect(() => {
    onListViewChange?.({ filter, search, sort });
  }, [filter, search, sort, onListViewChange]);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const tag of tags) m.set(tag.id, tag);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = sortInboxConversations(
      filterInboxConversations(conversations, filter, search),
      sort,
    );

    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        }),
      );
    }

    return result;
  }, [conversations, filter, search, sort, selectedTagIds, selectedCompany]);

  const hasSearchMatchesInAll = useMemo(() => {
    if (!search.trim() || filter === "all") return false;

    return conversations
      .filter(shouldShowInInboxList)
      .some((c) => matchesInboxSearch(c, search));
  }, [conversations, filter, search]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id],
    );
  }, []);

  const clearContactFilters = useCallback(() => {
    setSelectedTagIds([]);
    setSelectedCompany(null);
  }, []);

  const hasContactFilters =
    selectedTagIds.length > 0 || selectedCompany !== null;

  const handleSearchChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setSearch(e.target.value);
    },
    [],
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect],
  );

  const handleSeeAllChats = useCallback(() => {
    setFilter("all");
  }, []);

  const activeOtherFilter = OTHER_FILTERS.find((o) => o.value === filter);
  const activeSort = SORT_OPTIONS.find((o) => o.value === sort);

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-surface lg:w-80">
      <div className="space-y-2 border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-cabinet text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
            Inbox
          </h2>
          {onConversationCreated && (
            <NewMessageDialog onCreated={onConversationCreated} />
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={handleSearchChange}
            placeholder={t("searchPlaceholder")}
            className="rounded-[10px] border-border bg-accent pl-9 text-sm text-foreground placeholder-muted-foreground focus-visible:border-border-lit focus-visible:ring-0"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <div className="flex shrink-0 items-center rounded-md bg-muted p-0.5">
              {PRIMARY_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    "h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors",
                    filter === opt.value
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  "inline-flex h-7 max-w-[7rem] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted hover:text-foreground",
                  activeOtherFilter
                    ? "font-medium text-primary"
                    : "text-muted-foreground",
                )}
              >
                <span className="truncate">
                  {activeOtherFilter?.label ?? "Others"}
                </span>
                <ChevronDown className="h-3 w-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="border-border bg-popover"
              >
                {OTHER_FILTERS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => setFilter(opt.value)}
                    className={cn(
                      "text-sm",
                      filter === opt.value
                        ? "text-primary"
                        : "text-popover-foreground",
                    )}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {tags.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted",
                    selectedTagIds.length > 0
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t("tags")}
                  {selectedTagIds.length > 0 && (
                    <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
                      {selectedTagIds.length}
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-64 w-56 border-border bg-popover"
                >
                  {tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      checked={selectedTagIds.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      className="text-sm text-popover-foreground"
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="truncate">{tag.name}</span>
                      </span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {companies.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className={cn(
                    "inline-flex h-7 max-w-40 items-center justify-center gap-1 rounded-md px-2 text-xs hover:bg-muted",
                    selectedCompany
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <span className="truncate">
                    {selectedCompany ?? t("company")}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-h-64 w-56 border-border bg-popover"
                >
                  <DropdownMenuItem
                    onClick={() => setSelectedCompany(null)}
                    className={cn(
                      "text-sm",
                      selectedCompany === null
                        ? "text-primary"
                        : "text-popover-foreground",
                    )}
                  >
                    {t("allCompanies")}
                  </DropdownMenuItem>
                  {companies.map((co) => (
                    <DropdownMenuItem
                      key={co}
                      onClick={() => setSelectedCompany(co)}
                      className={cn(
                        "text-sm",
                        selectedCompany === co
                          ? "text-primary"
                          : "text-popover-foreground",
                      )}
                    >
                      <span className="truncate">{co}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
              {activeSort?.label ?? "Newest"}
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-border bg-popover"
            >
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => setSort(opt.value)}
                  className={cn(
                    "text-sm",
                    sort === opt.value
                      ? "text-primary"
                      : "text-popover-foreground",
                  )}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {hasContactFilters && (
          <div className="flex flex-wrap items-center gap-1">
            {selectedTagIds.map((id) => {
              const tag = tagsById.get(id);
              return (
                <button
                  key={id}
                  onClick={() => toggleTag(id)}
                  className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tag?.color ?? "var(--muted-foreground)",
                    }}
                  />
                  <span className="max-w-24 truncate">
                    {tag?.name ?? t("tags")}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted/70"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="px-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {t("clearAll")}
            </button>
          </div>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {t("noConversations")}
            </p>
            {hasSearchMatchesInAll && (
              <Button
                variant="link"
                size="sm"
                onClick={handleSeeAllChats}
                className="mt-2 text-primary"
              >
                See all chats
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-col">
            {filtered.map((conv) => (
              <ConversationItem
                key={conv.id}
                conversation={conv}
                isActive={conv.id === activeConversationId}
                onSelect={handleSelect}
                t={t}
              />
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

interface ConversationItemProps {
  conversation: Conversation;
  isActive: boolean;
  onSelect: (conversation: Conversation) => void;
  t: ReturnType<typeof useTranslations>;
}

function ConversationItem({
  conversation,
  isActive,
  onSelect,
  t,
}: ConversationItemProps) {
  const contact = conversation.contact;
  const displayName = contact?.name || contact?.phone || t("unknown");
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const activityAt = getInboxActivityAt(conversation);
  const timeAgo = activityAt
    ? formatDistanceToNow(new Date(activityAt), {
        addSuffix: false,
      })
    : "";

  return (
    <button
      onClick={handleClick}
      className={cn(
        "flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-accent/50",
        isActive && "border-l-[3px] border-primary bg-primary/5",
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
        {contact?.avatar_url ? (
          <img
            src={contact.avatar_url}
            alt={displayName}
            className="h-10 w-10 rounded-full object-cover"
          />
        ) : (
          initials
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-foreground">
            {displayName}
          </span>
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {timeAgo}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {conversation.last_message_text || t("noMessagesYet")}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                STATUS_COLORS[conversation.status],
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
