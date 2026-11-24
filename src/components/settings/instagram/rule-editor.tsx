'use client';
import { useState } from 'react';
import { ChevronDownIcon, LayoutGridIcon, LoaderCircleIcon, MessageCircleIcon, MousePointerClickIcon, PlusIcon, SearchIcon, ShoppingBagIcon, Trash2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { ChipsInput, Field, OptionCard, Thumb } from './fields';
import { callRules, mediaDate, mediaImage, mediaTitle, type Delivery, type MatchMode, type Media, type Product, type Rule, type RuleFields } from './types';

type Form = {
  mediaId: string | null; keywords: string[]; exclude: string[]; mode: MatchMode; skipMentions: boolean; text: string; delivery: Delivery; products: Product[];
  tapTitle: string; tapSubtitle: string; tapButton: string; reminder: string; reminderHours: string; publicReplies: string[]; limit: string;
};

function initialForm(rule: Rule | null, known: Product[]): Form {
  if (!rule) return { mediaId: null, keywords: [], exclude: [], mode: 'word', skipMentions: true, text: '', delivery: 'text', products: [], tapTitle: '', tapSubtitle: '', tapButton: 'View products', reminder: '', reminderHours: '10', publicReplies: [], limit: '100' };
  return {
    mediaId: rule.media_id, keywords: rule.keywords, exclude: rule.exclude_keywords, mode: rule.match_mode, skipMentions: rule.skip_mentions, text: rule.reply_text, delivery: rule.delivery,
    products: rule.product_ids.map((id) => known.find((p) => p.id === id) ?? { id, title: 'Unavailable product', image: null, price: null }),
    tapTitle: rule.tap_title, tapSubtitle: rule.tap_subtitle, tapButton: rule.tap_button || 'View products', reminder: rule.reminder_text ?? '', reminderHours: String(rule.reminder_minutes / 60),
    publicReplies: rule.public_replies, limit: String(rule.public_reply_limit),
  };
}

function Section({ step, title, children }: { step: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-3xl border border-border bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2.5 text-base font-semibold text-foreground"><span className="flex size-6 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{step}</span>{title}</h3>
      {children}
    </section>
  );
}

function Preview({ form }: { form: Form }) {
  const first = form.products[0];
  const card = (key: number, image: string | null | undefined, title: string, subtitle: string | null, label: string) => (
    <div key={key} className="w-44 shrink-0 overflow-hidden rounded-2xl border border-border bg-card">
      <Thumb src={image} className="aspect-square h-auto w-full rounded-none" />
      <div className="space-y-0.5 p-2.5"><p className="line-clamp-2 text-xs font-semibold">{title}</p>{subtitle && <p className="line-clamp-2 text-xs text-muted-foreground">{subtitle}</p>}</div>
      <p className="border-t border-border py-2 text-center text-xs font-semibold text-primary">{label}</p>
    </div>
  );
  return (
    <div className="space-y-2 rounded-2xl bg-accent p-3" aria-label="Message preview">
      <p className="text-xs font-medium text-muted-foreground">Preview</p>
      {form.delivery === 'text' && <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-card px-3 py-2 text-sm break-words whitespace-pre-wrap">{form.text || 'Your message appears here.'}</p>}
      {form.delivery === 'tap' && card(0, first?.image, form.tapTitle || 'Card title', form.tapSubtitle || null, form.tapButton || 'Button')}
      {form.delivery === 'tap' && <p className="text-xs text-muted-foreground">After they tap:</p>}
      {form.delivery !== 'text' && (form.products.length > 0
        ? <div className="flex gap-2 overflow-x-auto pb-1">{form.products.map((p) => card(p.id, p.image, p.title, p.price, 'View product'))}</div>
        : <p className="text-xs text-muted-foreground">Add a product to see its card.</p>)}
    </div>
  );
}

export function RuleEditor({ rule, connectionId, media, mediaError, known, onClose, onSaved }: { rule: Rule | null; connectionId: string; media: Media[] | null; mediaError: string; known: Product[]; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState(() => initialForm(rule, known));
  const [advanced, setAdvanced] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Product[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (values: Partial<Form>) => setForm((current) => ({ ...current, ...values }));

  const addProduct = (product: Product) => setForm((current) => (current.products.length >= 10 || current.products.some((p) => p.id === product.id) ? current : { ...current, products: [...current.products, product] }));

  const search = async () => {
    setSearching(true); setError('');
    try { setResults((await callRules('GET', undefined, `?products=${encodeURIComponent(query)}`)).products); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not search products.'); }
    finally { setSearching(false); }
  };
  const save = async () => {
    setSaving(true); setError('');
    const fields: RuleFields = {
      media_id: form.mediaId, keywords: form.keywords, exclude_keywords: form.exclude, match_mode: form.mode, skip_mentions: form.skipMentions,
      public_replies: form.publicReplies.map((r) => r.trim()).filter(Boolean), public_reply_limit: Number(form.limit), reply_text: form.text, delivery: form.delivery,
      product_ids: form.products.map((p) => p.id), tap_title: form.tapTitle, tap_subtitle: form.tapSubtitle, tap_button: form.tapButton, reminder_text: form.reminder, reminder_minutes: Math.round(Number(form.reminderHours) * 60),
    };
    try {
      await callRules(rule ? 'PUT' : 'POST', rule ? { id: rule.id, ...fields } : { connection_id: connectionId, ...fields });
      await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save the rule.'); setSaving(false); }
  };
  const posts = media ?? [];
  const missing = form.mediaId !== null && media !== null && !posts.some((m) => m.id === form.mediaId);

  return (
    <Sheet open onOpenChange={(open, details) => { if (!open && details.reason === 'outside-press') details.cancel(); else if (!open && !saving) onClose(); }}>
      <SheetContent className="w-full gap-0 bg-background p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <header className="border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="text-lg font-bold">{rule ? 'Edit rule' : 'New rule'}</SheetTitle>
          <SheetDescription>{rule?.active_since ? 'This rule is on. Changes apply to new comments as soon as you save.' : 'Saved rules stay off until you switch them on.'}</SheetDescription>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
          <Section step={1} title="Which comments">
            <Field label="Post">
              {mediaError ? <p className="text-sm text-destructive">{mediaError}</p> : media === null ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircleIcon className="size-4 animate-spin" />Loading your posts</p> : (
                <div role="radiogroup" aria-label="Post" className="grid max-h-72 grid-cols-3 gap-2 overflow-y-auto p-0.5 sm:grid-cols-5">
                  {[null, ...(missing ? [{ id: form.mediaId!, caption: 'Earlier post' } as Media] : []), ...posts].map((m) => {
                    const selected = form.mediaId === (m?.id ?? null);
                    return (
                      <label key={m?.id ?? 'recent'} title={m ? mediaTitle(m) : undefined} className={cn('cursor-pointer overflow-hidden rounded-xl border-2 bg-card has-focus-visible:ring-2 has-focus-visible:ring-ring', selected ? 'border-primary' : 'border-transparent hover:border-border')}>
                        <input type="radio" name="post" className="sr-only" checked={selected} onChange={() => set({ mediaId: m?.id ?? null })} aria-label={m ? `${mediaTitle(m)} ${mediaDate(m)}` : 'My 10 most recent posts'} />
                        {m ? <Thumb src={mediaImage(m)} className="aspect-square h-auto w-full rounded-none" /> : <span className="flex aspect-square flex-col items-center justify-center gap-1 bg-primary/10 p-1 text-center text-xs font-medium text-primary"><LayoutGridIcon className="size-6" /></span>}
                        <span className={cn('block truncate px-1.5 py-1 text-center text-[11px]', selected ? 'font-semibold text-primary' : 'text-muted-foreground')}>{m ? mediaDate(m) || 'Earlier post' : 'Latest 10'}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </Field>
            <Field id="rule-keywords" label="Reply when a comment contains" hint={form.keywords.length === 0 ? 'Empty means every comment gets a DM.' : undefined}>
              <ChipsInput id="rule-keywords" value={form.keywords} onChange={(keywords) => set({ keywords })} placeholder="price, link, how much" />
            </Field>
            <Field id="rule-exclude" label="Never reply to">
              <ChipsInput id="rule-exclude" tone="block" value={form.exclude} onChange={(exclude) => set({ exclude })} placeholder="refund, complaint" />
            </Field>
            <button type="button" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)} className="flex items-center gap-1 text-sm font-medium text-primary"><ChevronDownIcon className={cn('size-4 transition-transform', advanced && 'rotate-180')} />More options</button>
            {advanced && (
              <div className="space-y-3">
                <div role="radiogroup" aria-label="Match keywords" className="grid gap-2 sm:grid-cols-2">
                  <OptionCard name="mode" checked={form.mode === 'word'} onSelect={() => set({ mode: 'word' })} title="Whole words" description="“price” does not match “priceless”" />
                  <OptionCard name="mode" checked={form.mode === 'contains'} onSelect={() => set({ mode: 'contains' })} title="Anywhere" description="“plz” also matches “plzz”" />
                </div>
                <label className="flex items-center gap-2.5 text-sm"><Checkbox checked={form.skipMentions} onCheckedChange={(checked) => set({ skipMentions: checked === true })} />Skip comments that tag someone else</label>
              </div>
            )}
          </Section>

          <Section step={2} title="The DM">
            <div role="radiogroup" aria-label="How to send it" className="grid gap-2">
              <OptionCard name="delivery" checked={form.delivery === 'text'} onSelect={() => set({ delivery: 'text' })} icon={<MessageCircleIcon />} title="Text message" description="A simple message with a link." />
              <OptionCard name="delivery" checked={form.delivery === 'products'} onSelect={() => set({ delivery: 'products' })} icon={<ShoppingBagIcon />} title="Product cards" description="Products with image and price, straight away." />
              <OptionCard name="delivery" checked={form.delivery === 'tap'} onSelect={() => set({ delivery: 'tap' })} icon={<MousePointerClickIcon />} title="Button, then products" description="They tap first. Lets you send one reminder later." />
            </div>
            {form.delivery !== 'text' && (
              <Field id="product-search" label={`Products (${form.products.length}/10)`} hint="Sold-out products are left out. Prices stay up to date.">
                {form.products.length > 0 && <ul className="space-y-1.5">{form.products.map((p) => (
                  <li key={p.id} className="flex items-center gap-3 rounded-2xl bg-accent p-2"><Thumb src={p.image} className="size-10" /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{p.title}</span>{p.price && <span className="block text-xs text-muted-foreground">{p.price}</span>}</span><Button variant="ghost" size="icon-sm" aria-label={`Remove ${p.title}`} onClick={() => set({ products: form.products.filter((x) => x.id !== p.id) })}><Trash2Icon /></Button></li>
                ))}</ul>}
                <div className="flex gap-2">
                  <Input id="product-search" value={query} placeholder="Search your Shopify products" onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} />
                  <Button variant="outline" onClick={() => void search()} disabled={searching}>{searching ? <LoaderCircleIcon className="animate-spin" /> : <SearchIcon />}Search</Button>
                </div>
                {results && <ul className="max-h-56 space-y-1 overflow-y-auto">{results.length === 0 ? <li className="text-sm text-muted-foreground">No products found.</li> : results.map((p) => {
                  const added = form.products.some((x) => x.id === p.id);
                  return <li key={p.id}><button type="button" disabled={added || form.products.length >= 10} onClick={() => addProduct(p)} className="flex w-full items-center gap-3 rounded-xl p-2 text-left hover:bg-accent disabled:opacity-50"><Thumb src={p.image} className="size-9" /><span className="min-w-0 flex-1 truncate text-sm">{p.title}</span><span className="shrink-0 text-xs text-muted-foreground">{added ? 'Added' : p.price}</span></button></li>;
                })}</ul>}
              </Field>
            )}
            {form.delivery === 'tap' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="tap-title" label="Card title"><Input id="tap-title" maxLength={80} value={form.tapTitle} placeholder="Thanks for your interest!" onChange={(e) => set({ tapTitle: e.target.value })} /></Field>
                <Field id="tap-button" label="Button"><Input id="tap-button" maxLength={20} value={form.tapButton} onChange={(e) => set({ tapButton: e.target.value })} /></Field>
                <div className="sm:col-span-2"><Field id="tap-subtitle" label="Subtitle (optional)"><Input id="tap-subtitle" maxLength={80} value={form.tapSubtitle} placeholder="Tap below to see prices and designs" onChange={(e) => set({ tapSubtitle: e.target.value })} /></Field></div>
              </div>
            )}
            <Field id="rule-text" label={form.delivery === 'text' ? 'Message' : 'Backup text'} hint={form.delivery === 'text' ? undefined : 'Sent only if Instagram refuses the card or no product is available.'}>
              <Textarea id="rule-text" className="bg-card" rows={4} value={form.text} onChange={(e) => set({ text: e.target.value })} placeholder="Hi! Thanks for your comment. Here is the link: https://" />
            </Field>
            {form.delivery === 'tap' && (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                <Field id="reminder" label="Reminder (optional)" hint="Skipped if they write to you or your team replies. Add a discount code here if you like."><Textarea id="reminder" className="bg-card" rows={2} value={form.reminder} onChange={(e) => set({ reminder: e.target.value })} /></Field>
                <Field id="reminder-hours" label="Hours after tap"><Input id="reminder-hours" type="number" min={0.5} max={23} step={0.5} value={form.reminderHours} onChange={(e) => set({ reminderHours: e.target.value })} /></Field>
              </div>
            )}
            <Preview form={form} />
          </Section>

          <Section step={3} title="Public reply (optional)">
            <p className="text-sm text-muted-foreground">Posted under the comment after the DM is sent. One is picked at random, so add a few different wordings.</p>
            <div className="space-y-2">
              {form.publicReplies.map((reply, i) => (
                <div key={i} className="flex gap-2"><Input aria-label={`Public reply ${i + 1}`} maxLength={300} value={reply} placeholder="Thanks! We've sent you a DM." onChange={(e) => set({ publicReplies: form.publicReplies.map((r, n) => (n === i ? e.target.value : r)) })} /><Button variant="ghost" size="icon" aria-label={`Remove public reply ${i + 1}`} onClick={() => set({ publicReplies: form.publicReplies.filter((_, n) => n !== i) })}><Trash2Icon /></Button></div>
              ))}
              <Button variant="outline" size="sm" disabled={form.publicReplies.length >= 20} onClick={() => set({ publicReplies: [...form.publicReplies, ''] })}><PlusIcon />Add a reply</Button>
            </div>
            {form.publicReplies.length > 0 && <Field id="public-limit" label="Stop after this many per post" hint="DMs continue after the limit."><Input id="public-limit" className="max-w-32" type="number" min={1} max={1000} value={form.limit} onChange={(e) => set({ limit: e.target.value })} /></Field>}
          </Section>
        </div>
        <footer className="space-y-2 border-t border-border bg-card px-5 py-3">
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button><Button onClick={() => void save()} disabled={saving}>{saving ? 'Saving' : rule ? 'Save changes' : 'Save rule'}</Button></div>
        </footer>
      </SheetContent>
    </Sheet>
  );
}
