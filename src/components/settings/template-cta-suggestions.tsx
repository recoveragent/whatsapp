'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { TemplateButton } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getConfiguredSiteUrl } from '@/lib/auth/site-url';
import {
  CTA_LABELS,
  CTA_PURPOSES,
  CTA_VARIABLES,
  buttonCtaPurpose,
  isCtaPurpose,
  suggestedCta,
  type CtaPurpose,
} from '@/lib/whatsapp/template-cta';

export function TemplateCtaSuggestions({
  buttons,
  onChange,
  initialPurpose = 'custom',
}: {
  buttons: TemplateButton[];
  onChange: (buttons: TemplateButton[]) => void;
  initialPurpose?: CtaPurpose;
}) {
  const firstUrl = buttons.find((b) => b.type === 'URL');
  const [purpose, setPurpose] = useState<CtaPurpose>(
    firstUrl ? buttonCtaPurpose(firstUrl) : initialPurpose
  );
  const [storeUrl, setStoreUrl] = useState(() => {
    if (
      firstUrl?.type === 'URL' &&
      ['checkout', 'order_status'].includes(buttonCtaPurpose(firstUrl))
    ) {
      try {
        return new URL(firstUrl.url).origin;
      } catch {
        /* Ask for a valid origin below. */
      }
    }
    return '';
  });
  function apply() {
    if (purpose === 'custom') return;
    try {
      const site =
        getConfiguredSiteUrl() ||
        (typeof window !== 'undefined' ? window.location.origin : '');
      const button = suggestedCta(purpose, site, storeUrl);
      const index = buttons.findIndex((b) => b.type === 'URL');
      if (index < 0 && buttons.length >= 10)
        throw new Error('Remove a button before adding a suggested CTA.');
      onChange(
        index < 0
          ? [...buttons, button]
          : buttons.map((b, i) => (i === index ? button : b))
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : 'Enter a valid HTTPS website address.'
      );
    }
  }
  return (
    <section className="border-primary/20 bg-primary/5 space-y-3 rounded-lg border p-3">
      <label className="block space-y-1 text-xs font-medium">
        <span>Template purpose</span>
        <Select
          value={purpose}
          onValueChange={(v) => {
            if (isCtaPurpose(v)) setPurpose(v);
          }}
        >
          <SelectTrigger className="bg-background w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CTA_PURPOSES.map((p) => (
              <SelectItem key={p} value={p}>
                {CTA_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {purpose !== 'custom' && (
        <>
          {['checkout', 'order_status'].includes(purpose) && (
            <label className="block space-y-1 text-xs">
              <span>Store / checkout website</span>
              <Input
                type="url"
                value={storeUrl}
                onChange={(e) => setStoreUrl(e.target.value)}
                placeholder="https://your-store.com"
              />
              <span className="text-muted-foreground block">
                Use the domain from your actual customer links. Checkout and
                order-status links may use different domains.
              </span>
            </label>
          )}
          <p className="text-muted-foreground text-xs">
            Suggests a dynamic URL button and automatically maps it to the
            matching link in flows. You can edit the label and URL below.
          </p>
          <p className="text-xs">
            URL source: <code>{CTA_VARIABLES[purpose]}</code>
          </p>
          <Button type="button" size="sm" variant="outline" onClick={apply}>
            Use suggested CTA{firstUrl ? ' (replace first URL button)' : ''}
          </Button>
          <p className="text-muted-foreground text-[11px]">
            The example link is for template approval only. Each customer
            receives their own link at send time.
          </p>
        </>
      )}
    </section>
  );
}
