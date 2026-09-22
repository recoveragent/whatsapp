'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import type { MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, ChevronRight, LayoutTemplate, Loader2 } from 'lucide-react';
import { extractVariableIndices } from '@/lib/whatsapp/template-validators';
import { normalizeTemplateButtons } from '@/lib/flows/template-buttons';
import { TemplateMobilePreview } from '@/components/shared/template-mobile-preview';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

export interface TemplateSendValues {
  body: string[];
  headerText?: string;
  buttonParams?: Record<number, string>;
}

interface TemplatePickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (template: MessageTemplate, values: TemplateSendValues) => void;
  whatsappConfigId?: string | null;
}

function renderBodyPreview(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    const value = params[idx];
    return value && value.trim().length > 0 ? value : `{{${raw}}}`;
  });
}

interface UrlButtonSlot {
  index: number;
  text: string;
  url: string;
}

/**
 * Templates may need values for: body variables, a text-header
 * variable, and per-URL-button suffixes. Collect them all so the
 * send-message path doesn't 400 on missing parameters.
 */
function collectVariableSlots(template: MessageTemplate): {
  bodyVars: number[];
  headerVarCount: number;
  urlButtonSlots: UrlButtonSlot[];
} {
  const bodyVars = extractVariableIndices(template.body_text);
  const headerVarCount =
    template.header_type === 'text' && template.header_content
      ? extractVariableIndices(template.header_content).length
      : 0;
  const urlButtonSlots: UrlButtonSlot[] = [];
  (template.buttons ?? []).forEach((b, i) => {
    if (b.type === 'URL' && extractVariableIndices(b.url).length > 0) {
      urlButtonSlots.push({ index: i, text: b.text, url: b.url });
    }
  });
  return { bodyVars, headerVarCount, urlButtonSlots };
}

export function TemplatePicker({
  open,
  onOpenChange,
  onSelect,
  whatsappConfigId,
}: TemplatePickerProps) {
  const { accountId } = useAuth();
  const t = useTranslations('Inbox.templatePicker');
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<string[]>([]);
  const [headerText, setHeaderText] = useState<string>('');
  const [buttonParams, setButtonParams] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!accountId) {
        if (!cancelled) {
          setTemplates([]);
          setLoading(false);
        }
        return;
      }

      const supabase = createClient();
      let templatesQuery = supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', accountId)
        .eq('status', 'APPROVED')
        .order('created_at', { ascending: false });

      // Older conversations can predate per-WhatsApp-config mapping and
      // therefore have a null whatsapp_config_id. Never turn that null into
      // an empty-string equality: it hides every approved template. When a
      // conversation is mapped, keep templates scoped to that config.
      if (whatsappConfigId) {
        templatesQuery = templatesQuery.eq('whatsapp_config_id', whatsappConfigId);
      }

      const { data, error } = await templatesQuery;

      if (cancelled) return;
      if (error) {
        console.error('Failed to fetch templates:', error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [open, accountId, whatsappConfigId]);

  function resetSelection() {
    setSelected(null);
    setParams([]);
    setHeaderText('');
    setButtonParams({});
  }

  function handleOpenChange(next: boolean) {
    if (!next) resetSelection();
    onOpenChange(next);
  }

  function pickTemplate(template: MessageTemplate) {
    const slots = collectVariableSlots(template);
    const noInputsNeeded =
      slots.bodyVars.length === 0 &&
      slots.headerVarCount === 0 &&
      slots.urlButtonSlots.length === 0;
    if (noInputsNeeded) {
      onSelect(template, { body: [] });
      handleOpenChange(false);
      return;
    }
    setSelected(template);
    setParams(new Array(slots.bodyVars.length).fill(''));
    setHeaderText('');
    setButtonParams({});
  }

  function confirm() {
    if (!selected) return;
    const values: TemplateSendValues = { body: params };
    if (headerText.trim()) values.headerText = headerText.trim();
    if (Object.keys(buttonParams).length > 0) {
      values.buttonParams = Object.fromEntries(
        Object.entries(buttonParams).map(([k, v]) => [Number(k), v.trim()])
      );
    }
    onSelect(selected, values);
    handleOpenChange(false);
  }

  const slots = useMemo(
    () => (selected ? collectVariableSlots(selected) : null),
    [selected]
  );
  const canConfirm =
    !!selected &&
    !!slots &&
    slots.bodyVars.every((_, i) => (params[i] ?? '').trim().length > 0) &&
    (slots.headerVarCount === 0 || headerText.trim().length > 0) &&
    slots.urlButtonSlots.every(
      (s) => (buttonParams[s.index] ?? '').trim().length > 0
    );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          'border-border bg-popover',
          selected
            ? 'flex h-[min(90dvh,760px)] max-h-[760px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(94vw,1000px)]'
            : 'sm:max-w-lg'
        )}
      >
        <DialogHeader
          className={cn(
            selected && 'border-border shrink-0 border-b px-6 py-5 pr-14'
          )}
        >
          <DialogTitle className="text-popover-foreground flex items-center gap-2">
            <LayoutTemplate className="text-primary h-4 w-4" />
            {selected ? selected.name : t('sendTemplate')}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {selected ? t('fillPlaceholders') : t('pickTemplate')}
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="text-primary h-5 w-5 animate-spin" />
              </div>
            ) : templates.length === 0 ? (
              <div className="border-border bg-background/50 rounded-md border p-6 text-center">
                <p className="text-popover-foreground text-sm">
                  {t('noApprovedTemplates')}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {t('noApprovedTemplatesHint')}
                </p>
              </div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => pickTemplate(t)}
                  className="border-border bg-background/50 hover:border-primary/40 hover:bg-popover w-full rounded-md border p-3 text-left transition-colors"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-popover-foreground truncate text-sm font-medium">
                          {t.name}
                        </p>
                        <Badge className="border-primary/30 bg-primary/20 text-primary border text-[10px]">
                          {t.category}
                        </Badge>
                        {t.language && (
                          <span className="text-muted-foreground text-[10px] uppercase">
                            {t.language}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-foreground mt-1 line-clamp-2 text-xs">
                        {t.body_text}
                      </p>
                    </div>
                    <ChevronRight className="text-muted-foreground h-4 w-4 flex-shrink-0" />
                  </div>
                </button>
              ))
            )}
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_340px] md:overflow-hidden">
            <section className="min-w-0 p-5 md:overflow-y-auto md:p-6">
              <div className="mx-auto max-w-xl">
                <div className="mb-5">
                  <h3 className="text-popover-foreground text-sm font-semibold">
                    {t('requiredDetails')}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
                    {t('requiredDetailsHint')}
                  </p>
                </div>
                <div className="border-border bg-background/40 space-y-4 rounded-lg border p-4 shadow-sm">
                  {slots && slots.headerVarCount > 0 && (
                    <div className="space-y-1.5">
                      <Label className="text-popover-foreground text-xs font-medium">
                        {`Header {{1}}`}
                      </Label>
                      <Input
                        value={headerText}
                        onChange={(e) => setHeaderText(e.target.value)}
                        placeholder={t('headerValuePlaceholder')}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  )}
                  {slots?.bodyVars.map((v, i) => (
                    <div key={v} className="space-y-1.5">
                      <Label className="text-popover-foreground text-xs font-medium">{`Body {{${v}}}`}</Label>
                      <Input
                        value={params[i] ?? ''}
                        onChange={(e) => {
                          const next = [...params];
                          next[i] = e.target.value;
                          setParams(next);
                        }}
                        placeholder={t('bodyValuePlaceholder', {
                          val: `{{${v}}}`,
                        })}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                    </div>
                  ))}
                  {slots?.urlButtonSlots.map((slot) => (
                    <div key={slot.index} className="space-y-1.5">
                      <Label className="text-popover-foreground text-xs font-medium">
                        {`URL button "${slot.text}" — value for `}
                        {`{{1}}`}
                      </Label>
                      <Input
                        value={buttonParams[slot.index] ?? ''}
                        onChange={(e) =>
                          setButtonParams((prev) => ({
                            ...prev,
                            [slot.index]: e.target.value,
                          }))
                        }
                        placeholder={t('urlSuffixValuePlaceholder')}
                        className="border-border bg-background text-foreground placeholder:text-muted-foreground"
                      />
                      <p className="text-muted-foreground text-[10px] break-all">
                        {t('finalUrl', {
                          url: slot.url.replace(
                            /\{\{1\}\}/g,
                            buttonParams[slot.index] || '{{1}}'
                          ),
                        })}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <aside className="border-border bg-muted/30 min-w-0 border-t p-4 md:overflow-y-auto md:border-t-0 md:border-l">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <p className="text-popover-foreground text-xs font-medium">
                  {t('preview')}
                </p>
                <Badge className="border-primary/30 bg-primary/20 text-primary border text-[10px]">
                  {selected.category}
                </Badge>
                <span className="text-muted-foreground text-[10px]">
                  As seen on customer&apos;s phone
                </span>
              </div>
              <TemplateMobilePreview
                className="max-w-[270px]"
                bodyText={renderBodyPreview(selected.body_text, params)}
                headerType={selected.header_type}
                headerContent={
                  selected.header_type === 'text' && selected.header_content
                    ? selected.header_content.replace(
                        /\{\{(\d+)\}\}/g,
                        (_, n) =>
                          n === '1'
                            ? headerText.trim() || `{{${n}}}`
                            : `{{${n}}}`
                      )
                    : null
                }
                headerMediaUrl={selected.header_media_url}
                footerText={selected.footer_text}
                buttons={normalizeTemplateButtons(selected.buttons)}
              />
            </aside>
          </div>
        )}

        <DialogFooter
          className={cn(
            'gap-2',
            selected && 'mx-0 mb-0 shrink-0 rounded-none px-5 py-4'
          )}
        >
          {selected ? (
            <>
              <Button
                variant="outline"
                onClick={resetSelection}
                className="border-border text-popover-foreground hover:bg-muted"
              >
                <ArrowLeft className="h-4 w-4" />
                {t('back')}
              </Button>
              <Button
                disabled={!canConfirm}
                onClick={confirm}
                className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {t('send')}
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              className="border-border text-popover-foreground hover:bg-muted"
            >
              {t('cancel')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
