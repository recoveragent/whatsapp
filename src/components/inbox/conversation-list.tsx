'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import {
  matchesContactFilters,
  normalizeConversations,
} from '@/lib/inbox/conversations';
import { cn } from '@/lib/utils';
import type { Conversation, ConversationStatus, Tag } from '@/types';
import { Search, ChevronDown, RefreshCw, X } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { NewMessageDialog } from '@/components/inbox/new-message-dialog';
import {
  TopBarPortal,
  useTopBarSlotActive,
} from '@/components/layout/top-bar-slots';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  shouldShowInInboxList,
  matchesInboxSearch,
  filterInboxConversations,
  sortInboxConversations,
  getInboxActivityAt,
  type InboxFilter,
  type InboxSortOrder,
} from '@/lib/inbox/conversation-list';

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
  /** Inbound messages received since the list was last fetched. */
  pendingMessageCount?: number;
  /** Called after every full list fetch so the parent can reset the count. */
  onPendingMessagesCleared?: () => void;
  /**
   * When set, rows keep the position given by this id → last_message_at
   * snapshot and ids missing from it are hidden, so new messages don't
   * reorder the list until it is refreshed.
   */
  frozenActivity?: Record<string, string | null> | null;
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
  open: 'bg-primary',
  pending: 'bg-amber-500',
  closed: 'bg-muted-foreground',
  followup: 'bg-amber-500',
};

const SORT_OPTIONS: { label: string; value: InboxSortOrder }[] = [
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
];

const WHATSAPP_FILTER_STORAGE_KEY = 'wacrm:inbox:whatsapp-number-ids';
const CONVERSATIONS_PER_PAGE = 30;
type WhatsAppNumberOption = {
  id: string;
  reference_name: string;
  phone_number_id: string;
};

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
  pendingMessageCount = 0,
  onPendingMessagesCleared,
  frozenActivity = null,
  onConversationCreated,
  onListViewChange,
}: ConversationListProps) {
  const t = useTranslations('Inbox.conversationList');

  const PRIMARY_FILTERS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      { label: t('filterOpen'), value: 'open' },
      { label: t('filterClosed'), value: 'closed' },
    ],
    [t]
  );

  const OTHER_FILTERS: { label: string; value: InboxFilter }[] = useMemo(
    () => [
      { label: 'Followup', value: 'followup' },
      { label: t('filterPending'), value: 'pending' },
      { label: t('filterUnread'), value: 'unread' },
      { label: t('filterAll'), value: 'all' },
    ],
    [t]
  );

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<InboxFilter>('open');
  const [sort, setSort] = useState<InboxSortOrder>('newest');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [whatsappNumbers, setWhatsappNumbers] = useState<
    WhatsAppNumberOption[]
  >([]);
  const [selectedWhatsappIds, setSelectedWhatsappIds] = useState<string[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    onListViewChange?.({ filter, search, sort });
  }, [filter, search, sort, onListViewChange]);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  const onPendingMessagesClearedRef = useRef(onPendingMessagesCleared);
  const conversationsRef = useRef(conversations);
  const moreRequestRef = useRef<AbortController | null>(null);
  const listGenerationRef = useRef(0);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
    onPendingMessagesClearedRef.current = onPendingMessagesCleared;
  });
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const generation = ++listGenerationRef.current;
    moreRequestRef.current?.abort();
    moreRequestRef.current = null;
    setLoadingMore(false);

    const load = async () => {
      try {
        setLoading(true);
        setHasMore(false);
        setNextCursor(null);
        const params = new URLSearchParams({ sort, filter });
        if (search.trim()) params.set('search', search.trim());
        const response = await fetch(
          `/api/inbox/conversations/page?${params}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        const body = (await response.json()) as {
          conversations?: Conversation[];
          hasMore?: boolean;
          error?: string;
        };

        if (cancelled) return;

        if (!response.ok) {
          console.error('Failed to fetch conversations:', body.error);
          setLoading(false);
          return;
        }

        const loaded = normalizeConversations(body.conversations ?? []);
        conversationsRef.current = loaded;
        onConversationsLoadedRef.current(loaded);
        onPendingMessagesClearedRef.current?.();
        const cursor = loaded.at(-1)?.last_message_at ?? null;
        setNextCursor(cursor);
        setHasMore(Boolean(body.hasMore && cursor));
      } catch (error) {
        if (!cancelled) console.error('Failed to fetch conversations:', error);
      } finally {
        if (!cancelled && generation === listGenerationRef.current)
          setLoading(false);
      }
    };
    // Superseded searches never reach the server while the agent is typing.
    const timer = window.setTimeout(() => void load(), search.trim() ? 250 : 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      controller.abort();
      moreRequestRef.current?.abort();
    };
  }, [filter, refreshToken, resyncToken, search, sort]);

  const loadMoreConversations = useCallback(
    async (pageSize = CONVERSATIONS_PER_PAGE) => {
      if (
        loading ||
        loadingMore ||
        !hasMore ||
        !nextCursor ||
        moreRequestRef.current
      )
        return;

      const controller = new AbortController();
      moreRequestRef.current = controller;
      const generation = listGenerationRef.current;
      setLoadingMore(true);
      try {
        const params = new URLSearchParams({
          sort,
          filter,
          cursor: nextCursor,
          pageSize: String(pageSize),
        });
        if (search.trim()) params.set('search', search.trim());
        const response = await fetch(
          `/api/inbox/conversations/page?${params}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          }
        );
        const body = (await response.json()) as {
          conversations?: Conversation[];
          hasMore?: boolean;
          error?: string;
        };
        if (
          controller.signal.aborted ||
          generation !== listGenerationRef.current
        )
          return;
        if (!response.ok) {
          console.error('Failed to load more conversations:', body.error);
          setLoadingMore(false);
          return;
        }

        const loaded = normalizeConversations(body.conversations ?? []);
        const existingIds = new Set(
          conversationsRef.current.map((conversation) => conversation.id)
        );
        const merged = [
          ...conversationsRef.current,
          ...loaded.filter((conversation) => !existingIds.has(conversation.id)),
        ];
        conversationsRef.current = merged;
        onConversationsLoadedRef.current(merged);
        const cursor = loaded.at(-1)?.last_message_at ?? null;
        setNextCursor(cursor);
        setHasMore(Boolean(body.hasMore && cursor));
      } catch (error) {
        if (!controller.signal.aborted)
          console.error('Failed to load more conversations:', error);
      } finally {
        if (moreRequestRef.current === controller)
          moreRequestRef.current = null;
        if (generation === listGenerationRef.current) setLoadingMore(false);
      }
    },
    [filter, hasMore, loading, loadingMore, nextCursor, search, sort]
  );

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from('tags').select('*').order('name');
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    void supabase
      .from('whatsapp_config')
      .select('id, reference_name, phone_number_id')
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const options = data as WhatsAppNumberOption[];
        setWhatsappNumbers(options);
        let stored: string[] | null = null;
        try {
          const raw = localStorage.getItem(WHATSAPP_FILTER_STORAGE_KEY);
          if (raw) stored = JSON.parse(raw) as string[];
        } catch {
          // Best-effort device persistence.
        }
        const validStored = stored?.filter((id) =>
          options.some((item) => item.id === id)
        );
        setSelectedWhatsappIds(
          validStored?.length ? validStored : options.map((item) => item.id)
        );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleWhatsappNumber = useCallback((id: string) => {
    setSelectedWhatsappIds((previous) => {
      const next = previous.includes(id)
        ? previous.filter((item) => item !== id)
        : [...previous, id];
      try {
        localStorage.setItem(WHATSAPP_FILTER_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Best-effort device persistence.
      }
      return next;
    });
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
    let result: Conversation[];
    if (frozenActivity) {
      // Sort by the snapshot times, then swap the live rows back in so
      // previews and badges stay current while positions hold still.
      const visible = filterInboxConversations(
        conversations.filter((c) => c.id in frozenActivity),
        filter,
        search
      );
      const byId = new Map(visible.map((c) => [c.id, c]));
      result = sortInboxConversations(
        visible.map((c) => ({ ...c, last_message_at: frozenActivity[c.id] })),
        sort
      ).map((c) => byId.get(c.id)!);
    } else {
      result = sortInboxConversations(
        filterInboxConversations(conversations, filter, search),
        sort
      );
    }

    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    if (whatsappNumbers.length > 1) {
      result = result.filter((conversation) =>
        Boolean(
          conversation.whatsapp_config_id &&
          selectedWhatsappIds.includes(conversation.whatsapp_config_id)
        )
      );
    }

    return result;
  }, [
    conversations,
    frozenActivity,
    filter,
    search,
    sort,
    selectedTagIds,
    selectedCompany,
    whatsappNumbers.length,
    selectedWhatsappIds,
  ]);

  const canRefillPage =
    !search.trim() &&
    selectedTagIds.length === 0 &&
    selectedCompany === null &&
    (whatsappNumbers.length < 2 ||
      selectedWhatsappIds.length === whatsappNumbers.length);

  // Closing a conversation removes it from the selected status tab. Keep the
  // current page full by fetching one replacement, without expanding the page.
  useEffect(() => {
    if (
      !canRefillPage ||
      filtered.length >= CONVERSATIONS_PER_PAGE ||
      !hasMore ||
      loadingMore
    ) {
      return;
    }

    const refillTimer = window.setTimeout(() => {
      void loadMoreConversations(1);
    }, 0);
    return () => window.clearTimeout(refillTimer);
  }, [
    canRefillPage,
    filtered.length,
    hasMore,
    loadingMore,
    loadMoreConversations,
  ]);

  const hasSearchMatchesInAll = useMemo(() => {
    if (!search.trim() || filter === 'all') return false;

    return conversations
      .filter(shouldShowInInboxList)
      .some((c) => matchesInboxSearch(c, search));
  }, [conversations, filter, search]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((tagId) => tagId !== id) : [...prev, id]
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
    []
  );

  const handleSelect = useCallback(
    (conv: Conversation) => {
      onSelect(conv);
    },
    [onSelect]
  );

  const handleSeeAllChats = useCallback(() => {
    setFilter('all');
  }, []);

  const activeOtherFilter = OTHER_FILTERS.find((o) => o.value === filter);
  const activeSort = SORT_OPTIONS.find((o) => o.value === sort);

  // Desktop lifts search + New message into the shell's top bar.
  const searchInTopBar = useTopBarSlotActive('start');
  const searchField = (
    <div className={cn('relative', searchInTopBar && 'min-w-0 flex-1')}>
      <Search
        className={cn(
          'text-muted-foreground absolute top-1/2 -translate-y-1/2',
          searchInTopBar ? 'left-2.5 h-3.5 w-3.5' : 'left-3 h-4 w-4'
        )}
      />
      <Input
        value={search}
        onChange={handleSearchChange}
        placeholder={t('searchPlaceholder')}
        className={cn(
          'border-border bg-accent text-foreground focus-visible:border-border-lit focus-visible:ring-0',
          searchInTopBar
            ? 'h-8 rounded-full pl-8 text-[13px]'
            : 'rounded-[10px] pl-9 text-sm'
        )}
      />
    </div>
  );
  const newMessageButton = onConversationCreated ? (
    <NewMessageDialog
      onCreated={onConversationCreated}
      compact={searchInTopBar}
    />
  ) : null;

  return (
    <div className="border-border bg-surface flex h-full w-full flex-col border-r lg:w-80">
      <div className="border-border space-y-2 border-b p-3">
        {searchInTopBar ? (
          <TopBarPortal slot="start">
            {searchField}
            {newMessageButton}
          </TopBarPortal>
        ) : null}
        {!searchInTopBar || whatsappNumbers.length > 1 ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              <h2 className="font-cabinet text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
                Inbox
              </h2>
              {whatsappNumbers.length > 1 && (
                <DropdownMenu>
                  <DropdownMenuTrigger className="text-foreground hover:bg-muted inline-flex h-7 max-w-40 items-center gap-1 rounded-md px-2 text-xs font-medium">
                    <span className="truncate">
                      {selectedWhatsappIds.length === whatsappNumbers.length
                        ? 'All numbers'
                        : selectedWhatsappIds.length === 1
                          ? whatsappNumbers.find(
                              (item) => item.id === selectedWhatsappIds[0]
                            )?.reference_name
                          : `${selectedWhatsappIds.length} numbers`}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="border-border bg-popover w-56"
                  >
                    {whatsappNumbers.map((number) => (
                      <DropdownMenuCheckboxItem
                        key={number.id}
                        checked={selectedWhatsappIds.includes(number.id)}
                        onSelect={(event) => event.preventDefault()}
                        onCheckedChange={() => toggleWhatsappNumber(number.id)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate">
                            {number.reference_name}
                          </span>
                          <span className="text-muted-foreground block truncate text-[10px]">
                            {number.phone_number_id}
                          </span>
                        </span>
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
            {!searchInTopBar && newMessageButton}
          </div>
        ) : null}
        {!searchInTopBar && searchField}

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <div className="bg-muted flex shrink-0 items-center rounded-md p-0.5">
              {PRIMARY_FILTERS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setFilter(opt.value)}
                  className={cn(
                    'h-6 rounded-[5px] px-2.5 text-xs font-medium transition-colors',
                    filter === opt.value
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger
                className={cn(
                  'hover:bg-muted hover:text-foreground inline-flex h-7 max-w-[7rem] shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs',
                  activeOtherFilter
                    ? 'text-primary font-medium'
                    : 'text-muted-foreground'
                )}
              >
                <span className="truncate">
                  {activeOtherFilter?.label ?? 'Others'}
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
                      'text-sm',
                      filter === opt.value
                        ? 'text-primary'
                        : 'text-popover-foreground'
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
                    'hover:bg-muted inline-flex h-7 items-center justify-center gap-1 rounded-md px-2 text-xs',
                    selectedTagIds.length > 0
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t('tags')}
                  {selectedTagIds.length > 0 && (
                    <span className="bg-primary text-primary-foreground flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold">
                      {selectedTagIds.length}
                    </span>
                  )}
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="border-border bg-popover max-h-64 w-56"
                >
                  {tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      checked={selectedTagIds.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      className="text-popover-foreground text-sm"
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
                    'hover:bg-muted inline-flex h-7 max-w-40 items-center justify-center gap-1 rounded-md px-2 text-xs',
                    selectedCompany
                      ? 'text-primary'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <span className="truncate">
                    {selectedCompany ?? t('company')}
                  </span>
                  <ChevronDown className="h-3 w-3 shrink-0" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="border-border bg-popover max-h-64 w-56"
                >
                  <DropdownMenuItem
                    onClick={() => setSelectedCompany(null)}
                    className={cn(
                      'text-sm',
                      selectedCompany === null
                        ? 'text-primary'
                        : 'text-popover-foreground'
                    )}
                  >
                    {t('allCompanies')}
                  </DropdownMenuItem>
                  {companies.map((co) => (
                    <DropdownMenuItem
                      key={co}
                      onClick={() => setSelectedCompany(co)}
                      className={cn(
                        'text-sm',
                        selectedCompany === co
                          ? 'text-primary'
                          : 'text-popover-foreground'
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
            <DropdownMenuTrigger className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs">
              {activeSort?.label ?? 'Newest'}
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
                    'text-sm',
                    sort === opt.value
                      ? 'text-primary'
                      : 'text-popover-foreground'
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
                  className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
                >
                  <span
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: tag?.color ?? 'var(--muted-foreground)',
                    }}
                  />
                  <span className="max-w-24 truncate">
                    {tag?.name ?? t('tags')}
                  </span>
                  <X className="h-3 w-3" />
                </button>
              );
            })}
            {selectedCompany && (
              <button
                onClick={() => setSelectedCompany(null)}
                className="bg-muted text-foreground hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
              >
                <span className="max-w-24 truncate">{selectedCompany}</span>
                <X className="h-3 w-3" />
              </button>
            )}
            <button
              onClick={clearContactFilters}
              className="text-muted-foreground hover:text-foreground px-1 text-[11px]"
            >
              {t('clearAll')}
            </button>
          </div>
        )}
      </div>

      {pendingMessageCount > 0 && !loading && (
        <button
          type="button"
          onClick={() => setRefreshToken((n) => n + 1)}
          className="border-border bg-primary/10 text-primary hover:bg-primary/15 flex w-full shrink-0 items-center justify-center gap-1.5 border-b px-3 py-1.5 text-xs font-medium transition-colors"
        >
          <RefreshCw className="h-3 w-3" />
          {pendingMessageCount === 1
            ? '1 new message'
            : `${pendingMessageCount} new messages`}
        </button>
      )}

      <ScrollArea className="min-h-0 flex-1">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="border-primary h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-muted-foreground text-sm">
              {t('noConversations')}
            </p>
            {hasSearchMatchesInAll && (
              <Button
                variant="link"
                size="sm"
                onClick={handleSeeAllChats}
                className="text-primary mt-2"
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
            {hasMore && (
              <div className="px-3 py-3">
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => void loadMoreConversations()}
                  disabled={loadingMore}
                >
                  {loadingMore ? t('loadingMore') : t('loadMore')}
                </Button>
              </div>
            )}
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
  const displayName = contact?.name || contact?.phone || t('unknown');
  const initials = displayName.charAt(0).toUpperCase();

  const handleClick = useCallback(() => {
    onSelect(conversation);
  }, [onSelect, conversation]);

  const activityAt = getInboxActivityAt(conversation);
  const timeAgo = activityAt
    ? formatDistanceToNow(new Date(activityAt), {
        addSuffix: false,
      })
    : '';

  return (
    <button
      onClick={handleClick}
      className={cn(
        'hover:bg-accent/50 flex w-full items-start gap-3 px-3 py-3 text-left transition-colors',
        isActive && 'border-primary bg-primary/5 border-l-[3px]'
      )}
    >
      <div className="bg-muted text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-medium">
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
          <span className="text-foreground truncate text-sm font-medium">
            {displayName}
          </span>
          <span className="text-muted-foreground shrink-0 text-[10px]">
            {timeAgo}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="text-muted-foreground truncate text-xs">
            {conversation.last_message_text || t('noMessagesYet')}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {conversation.unread_count > 0 && (
              <span className="bg-destructive flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white">
                {conversation.unread_count}
              </span>
            )}
            <span
              className={cn(
                'h-2 w-2 rounded-full',
                STATUS_COLORS[conversation.status]
              )}
              title={conversation.status}
            />
          </div>
        </div>
      </div>
    </button>
  );
}
