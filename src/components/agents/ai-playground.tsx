'use client';

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Bot,
  RotateCcw,
  Send,
  Loader2,
  UserCircle2,
  ArrowRight,
  ShoppingBag,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import type { PlaygroundProductCarousel } from '@/lib/ai/playground-carousel';
import type { Contact } from '@/types';

import { PlaygroundProductCarouselPreview } from './playground-product-carousel';

const NO_CONTACT = '__none__';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
  /** assistant-only: the agent signalled a human handoff on this turn. */
  handoff?: boolean;
  productCarousel?: PlaygroundProductCarousel | null;
}

function contactLabel(contact: Contact): string {
  const name = contact.name?.trim();
  if (name) return `${name} (${contact.phone})`;
  return contact.phone;
}

export function AiPlayground({ onGoToSetup }: { onGoToSetup?: () => void }) {
  const { isShopifyBrand, accountId } = useAuth();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [contactId, setContactId] = useState('');
  const [orderCount, setOrderCount] = useState<number | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isShopifyBrand || !accountId) return;

    let cancelled = false;
    setContactsLoading(true);

    (async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('contacts')
        .select('id, phone, name, email')
        .eq('account_id', accountId)
        .order('name', { ascending: true, nullsFirst: false })
        .limit(100);

      if (cancelled) return;
      if (error) {
        console.error('[ai-playground] contacts load failed:', error);
        setContacts([]);
      } else {
        setContacts((data ?? []) as Contact[]);
      }
      setContactsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [isShopifyBrand, accountId]);

  useEffect(() => {
    if (!contactId) {
      setOrderCount(null);
      return;
    }

    let cancelled = false;
    setOrdersLoading(true);

    (async () => {
      try {
        const res = await fetch(
          `/api/shopify/orders?contact_id=${encodeURIComponent(contactId)}`,
          { cache: 'no-store' },
        );
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        setOrderCount(Array.isArray(data.orders) ? data.orders.length : 0);
      } catch {
        if (!cancelled) setOrderCount(null);
      } finally {
        if (!cancelled) setOrdersLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contactId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [turns, sending]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next);
    setInput('');
    setSending(true);
    try {
      const res = await fetch('/api/ai/playground', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Send only role+content — the server ignores anything else.
        body: JSON.stringify({
          messages: next.map((t) => ({ role: t.role, content: t.content })),
          ...(contactId ? { contact_id: contactId } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.code === 'ai_not_configured') {
          toast.error('No agent configured yet — finish Setup first.');
        } else {
          toast.error(data.error ?? "Couldn't get a reply.");
        }
        // Roll the unsent user turn back so the transcript stays clean.
        setTurns(turns);
        setInput(text);
        return;
      }
      setTurns([
        ...next,
        {
          role: 'assistant',
          content:
            typeof data.reply === 'string' && data.reply.trim()
              ? data.reply
              : '',
          handoff: Boolean(data.handoff),
          productCarousel: data.product_carousel ?? null,
        },
      ]);
    } catch {
      toast.error("Couldn't reach the agent.");
      setTurns(turns);
      setInput(text);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="flex h-[60vh] min-h-[420px] flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <div className="space-y-2 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-medium text-foreground">Playground</span>
            <span className="hidden text-xs text-muted-foreground sm:inline">
              — test replies as if you were a customer
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setTurns([])}
            disabled={turns.length === 0 || sending}
            className="shrink-0 text-muted-foreground"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Reset
          </Button>
        </div>

        {isShopifyBrand && (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={contactId || NO_CONTACT}
              onValueChange={(value) =>
                setContactId(!value || value === NO_CONTACT ? '' : value)
              }
              disabled={contactsLoading || sending}
            >
              <SelectTrigger className="h-8 w-full max-w-sm text-xs">
                <SelectValue
                  placeholder={
                    contactsLoading ? 'Loading contacts…' : 'Simulate a customer'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_CONTACT}>No contact (generic test)</SelectItem>
                {contacts.map((contact) => (
                  <SelectItem key={contact.id} value={contact.id}>
                    {contactLabel(contact)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {contactId && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <ShoppingBag className="h-3.5 w-3.5" />
                {ordersLoading
                  ? 'Loading Shopify orders…'
                  : orderCount === null
                    ? 'Could not load orders'
                    : orderCount === 0
                      ? 'No Shopify orders for this contact'
                      : `${orderCount} Shopify order${orderCount === 1 ? '' : 's'} in context`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center text-center text-sm text-muted-foreground">
            <Bot className="mb-2 h-8 w-8 text-muted-foreground/60" />
            <p>Send a message to see how your agent would reply.</p>
            <p className="mt-1 text-xs">
              It uses your knowledge base and behaves exactly like the
              auto-reply bot — including handoff.
            </p>
            {isShopifyBrand && (
              <p className="mt-1 max-w-sm text-xs">
                Pick a customer to test order context, or ask “show me products”
                to preview the product recommendation carousel.
              </p>
            )}
            {onGoToSetup && (
              <Button
                variant="link"
                size="sm"
                onClick={onGoToSetup}
                className="mt-1 h-auto p-0 text-xs"
              >
                Not set up yet? Go to Setup <ArrowRight className="ml-1 h-3 w-3" />
              </Button>
            )}
          </div>
        )}

        {turns.map((t, i) => (
          <div
            key={i}
            className={cn(
              'flex gap-2',
              t.role === 'user' ? 'justify-end' : 'justify-start',
            )}
          >
            {t.role === 'assistant' && (
              <Bot className="mt-1 h-5 w-5 shrink-0 text-primary" />
            )}
            <div
              className={cn(
                t.productCarousel ? 'max-w-[92%]' : 'max-w-[80%]',
                'rounded-2xl px-3.5 py-2 text-sm',
                t.role === 'user'
                  ? 'rounded-br-sm bg-primary text-primary-foreground'
                  : 'rounded-bl-sm bg-muted text-foreground',
              )}
            >
              {t.content && <p className="whitespace-pre-wrap">{t.content}</p>}
              {t.role === 'assistant' && t.productCarousel && (
                <PlaygroundProductCarouselPreview carousel={t.productCarousel} />
              )}
              {t.role === 'assistant' && t.handoff && (
                <p
                  className={cn(
                    'flex items-center gap-1 text-xs text-amber-500',
                    t.content && 'mt-1.5 border-t border-border/50 pt-1.5',
                  )}
                >
                  <UserCircle2 className="h-3.5 w-3.5" />
                  Would hand off to a human here
                </p>
              )}
            </div>
            {t.role === 'user' && (
              <UserCircle2 className="mt-1 h-5 w-5 shrink-0 text-muted-foreground" />
            )}
          </div>
        ))}

        {sending && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Bot className="h-5 w-5 text-primary" />
            <Loader2 className="h-4 w-4 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="flex items-end gap-2 border-t border-border p-3">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type a customer message…"
          rows={1}
          className="flex-1 resize-none rounded-xl border border-border bg-muted px-4 py-2.5 text-sm text-foreground placeholder-muted-foreground outline-none focus:border-primary/50"
        />
        <Button
          size="sm"
          onClick={send}
          disabled={!input.trim() || sending}
          className="h-9 w-9 shrink-0 p-0"
        >
          {sending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
        </Button>
      </div>
    </div>
  );
}
