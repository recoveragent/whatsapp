'use client';
import { useState, type ReactNode } from 'react';
import { ImageIcon, XIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

/** Square preview used for posts and products. */
export function Thumb({ src, className }: { src?: string | null; className?: string }) {
  const [broken, setBroken] = useState<string | null>(null);
  return (
    <span className={cn('flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-accent text-muted-foreground', className)}>
      {src && broken !== src ? (
        // Remote Instagram and Shopify images; sizes are unknown and links expire.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setBroken(src)} />
      ) : <ImageIcon className="size-5" aria-hidden />}
    </span>
  );
}

/** Keywords as removable chips. Enter or a comma adds; pasted lists are split. */
export function ChipsInput({ id, value, onChange, placeholder, tone = 'default' }: { id: string; value: string[]; onChange: (next: string[]) => void; placeholder: string; tone?: 'default' | 'block' }) {
  const [draft, setDraft] = useState('');
  const add = (text: string) => {
    const next = [...value];
    for (const part of text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean)) if (!next.some((v) => v.toLowerCase() === part.toLowerCase())) next.push(part);
    setDraft('');
    if (next.length !== value.length) onChange(next);
  };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-card px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring">
      {value.map((item) => (
        <span key={item} className={cn('inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2.5 text-xs font-medium', tone === 'block' ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary')}>
          {item}
          <button type="button" aria-label={`Remove ${item}`} onClick={() => onChange(value.filter((v) => v !== item))} className="rounded-full p-0.5 hover:bg-foreground/10"><XIcon className="size-3" /></button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length === 0 ? placeholder : 'Add another'}
        className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground"
        onChange={(e) => (e.target.value.includes(',') ? add(e.target.value) : setDraft(e.target.value))}
        onPaste={(e) => { const text = e.clipboardData.getData('text'); if (/[,\n]/.test(text)) { e.preventDefault(); add(text); } }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); add(draft); }
          if (e.key === 'Backspace' && draft === '' && value.length > 0) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

/** A selectable card backed by a real radio input, so keyboard and screen readers work. */
export function OptionCard({ name, checked, onSelect, icon, title, description }: { name: string; checked: boolean; onSelect: () => void; icon?: ReactNode; title: string; description?: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-ring', checked ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-accent')}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} className="sr-only" />
      {icon && <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-xl [&_svg]:size-4', checked ? 'bg-primary text-primary-foreground' : 'bg-accent text-muted-foreground')}>{icon}</span>}
      <span className="min-w-0">
        <span className="block text-sm font-medium text-foreground">{title}</span>
        {description && <span className="block text-xs text-muted-foreground">{description}</span>}
      </span>
    </label>
  );
}

export function Field({ id, label, hint, children }: { id?: string; label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
