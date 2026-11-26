'use client';

import { CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { TemplateMobilePreview } from '@/components/shared/template-mobile-preview';
import type { MessageTemplate, TemplateButton } from '@/types';

export interface LibraryTemplatePayload {
  name: string;
  category: MessageTemplate['category'];
  language: string;
  header_format: 'none' | 'text' | 'image' | 'video' | 'document';
  header_content: string;
  header_media_url: string;
  header_sample: string;
  body_text: string;
  body_samples: string[];
  footer_text: string;
  buttons: TemplateButton[];
}

export interface LibraryTemplateItem {
  slug: string;
  title: string;
  description: string;
  media_note: string | null;
  payload: LibraryTemplatePayload;
}

/** A media header (image/video/document) needs a link before Meta review. */
export function libraryTemplateNeedsMedia(item: LibraryTemplateItem): boolean {
  const { header_format, header_media_url } = item.payload;
  return (
    header_format !== 'none' &&
    header_format !== 'text' &&
    !header_media_url.trim()
  );
}

function fillSamples(text: string, samples: string[]): string {
  return text.replace(/\{\{(\d+)\}\}/g, (match, n) => {
    const value = samples[Number(n) - 1]?.trim();
    return value || match;
  });
}

interface TemplateLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: LibraryTemplateItem[];
  approvingSlug: string | null;
  businessName?: string;
  onApprove: (item: LibraryTemplateItem) => void;
  onEdit: (item: LibraryTemplateItem) => void;
}

export function TemplateLibraryDialog({
  open,
  onOpenChange,
  items,
  approvingSlug,
  businessName,
  onApprove,
  onEdit,
}: TemplateLibraryDialogProps) {
  const t = useTranslations('Settings.templates');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 px-6 pt-6 pr-12">
          <DialogTitle>{t('libraryTitle')}</DialogTitle>
          <DialogDescription>{t('libraryDesc')}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <CheckCircle2 className="size-8 text-primary" />
              <p className="text-sm text-muted-foreground">{t('libraryEmpty')}</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((item) => {
                const { payload } = item;
                const needsMedia = libraryTemplateNeedsMedia(item);
                const busy = approvingSlug === item.slug;
                return (
                  <div
                    key={item.slug}
                    className="flex flex-col gap-3 rounded-xl border border-border bg-card/70 p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {item.title}
                        </p>
                        {item.description ? (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {item.description}
                          </p>
                        ) : null}
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {payload.name} · {payload.language} · {payload.category}
                        </p>
                      </div>
                      <Badge
                        variant="outline"
                        className="shrink-0 border-amber-500/30 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300"
                      >
                        {t('libraryWaiting')}
                      </Badge>
                    </div>

                    <div className="rounded-lg bg-muted/30 py-3">
                      <TemplateMobilePreview
                        bodyText={fillSamples(payload.body_text, payload.body_samples)}
                        headerType={
                          payload.header_format === 'none'
                            ? null
                            : payload.header_format
                        }
                        headerContent={
                          payload.header_format === 'text'
                            ? fillSamples(payload.header_content, [
                                payload.header_sample,
                              ])
                            : null
                        }
                        headerMediaUrl={payload.header_media_url || null}
                        footerText={payload.footer_text || null}
                        buttons={payload.buttons}
                        businessName={businessName}
                      />
                    </div>

                    {needsMedia ? (
                      <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                        {item.media_note || t('libraryNeedsMedia')}
                      </p>
                    ) : null}

                    <div className="mt-auto flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => onEdit(item)}
                        disabled={busy}
                      >
                        <Pencil className="size-4" />
                        {t('libraryEdit')}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => onApprove(item)}
                        disabled={busy || needsMedia || approvingSlug !== null}
                      >
                        {busy ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <CheckCircle2 className="size-4" />
                        )}
                        {t('libraryApprove')}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
