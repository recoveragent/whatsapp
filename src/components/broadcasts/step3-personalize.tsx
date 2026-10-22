'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { Contact, CustomField, MessageTemplate } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ArrowLeft, ArrowRight, Eye, ImageIcon, Loader2 } from 'lucide-react';
import { normalizeTemplateButtons } from '@/lib/flows/template-buttons';
import {
  resolveVariable,
  broadcastFallbackText,
  broadcastCustomFieldToken,
  type VariableMapping,
} from '@/lib/broadcast-variables';
import { TemplateMobilePreview } from '@/components/shared/template-mobile-preview';
import { useTranslations } from 'next-intl';
import { VariableFallbackFields } from '@/components/shared/variable-fallback-fields';
import {
  missingVariableFallbacks,
  preserveVariableFallbacks,
  withoutVariableFallbacks,
} from '@/lib/flows/variable-fallback';
import { TemplateVariablePicker } from '@/components/shared/template-variable-picker';
import { templateVariableGroupsForAutomation } from '@/lib/flows/template-variables';

type VariableType = VariableMapping['type'];

function BroadcastFallbackInput({
  mapping,
  customFields,
  onChange,
  placeholder,
  label,
}: {
  mapping: VariableMapping;
  customFields: CustomField[];
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
}) {
  const [showVariables, setShowVariables] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selection = useRef({ start: 0, end: 0 });
  const value = broadcastFallbackText(mapping);
  const groups = templateVariableGroupsForAutomation().filter(
    (group) => group.id === 'contact'
  );
  if (customFields.length) {
    groups.push({
      id: 'custom',
      label: 'Custom user attributes',
      options: customFields.map((field) => ({
        label: field.field_name,
        token: broadcastCustomFieldToken(field.id),
        type: 'text',
      })),
    });
  }
  function insertToken(token: string) {
    const { start, end } = selection.current;
    onChange(
      preserveVariableFallbacks(
        withoutVariableFallbacks(value).slice(0, start) +
          token +
          withoutVariableFallbacks(value).slice(end),
        value
      )
    );
    selection.current = {
      start: start + token.length,
      end: start + token.length,
    };
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(
        start + token.length,
        start + token.length
      );
    });
  }
  return (
    <>
      <Input
        ref={inputRef}
        aria-label={label}
        value={withoutVariableFallbacks(value)}
        required
        aria-invalid={
          !value.trim() || missingVariableFallbacks(value).length > 0
        }
        onChange={(event) =>
          onChange(preserveVariableFallbacks(event.target.value, value))
        }
        onSelect={(event) => {
          selection.current = {
            start: event.currentTarget.selectionStart ?? value.length,
            end: event.currentTarget.selectionEnd ?? value.length,
          };
        }}
        placeholder={placeholder}
        className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
      />
      <VariableFallbackFields value={value} onChange={onChange} />
      {!value.trim() && (
        <p className="text-destructive mt-1 text-xs">
          Fallback text is required.
        </p>
      )}
      <button
        type="button"
        className="text-muted-foreground hover:text-foreground mt-1 text-xs"
        aria-expanded={showVariables}
        onClick={() => setShowVariables(!showVariables)}
      >
        Add variables
      </button>
      {showVariables && (
        <TemplateVariablePicker
          groups={groups}
          onInsert={insertToken}
          className="mt-2"
        />
      )}
    </>
  );
}

interface Step3Props {
  template: MessageTemplate;
  variables: Record<string, VariableMapping>;
  onUpdate: (variables: Record<string, VariableMapping>) => void;
  /** Media URL for an IMAGE/VIDEO/DOCUMENT header, when the template has one. */
  headerMediaUrl: string;
  onHeaderMediaUrlChange: (url: string) => void;
  onNext: () => void;
  onBack: () => void;
}

const MEDIA_HEADER_TYPES = ['image', 'video', 'document'] as const;
type MediaHeaderType = (typeof MEDIA_HEADER_TYPES)[number];

function isMediaHeaderType(value: unknown): value is MediaHeaderType {
  return MEDIA_HEADER_TYPES.includes(value as MediaHeaderType);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

const contactFields = [
  { value: 'name', labelKey: 'name' },
  { value: 'phone', labelKey: 'phone' },
  { value: 'email', labelKey: 'email' },
];

const SAMPLE_CONTACT: Contact = {
  id: 'sample',
  user_id: '',
  account_id: '',
  name: 'John Doe',
  phone: '+1234567890',
  email: 'john@example.com',
  company: 'Acme Corp',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

export function Step3Personalize({
  template,
  variables,
  onUpdate,
  headerMediaUrl,
  onHeaderMediaUrlChange,
  onNext,
  onBack,
}: Step3Props) {
  const t = useTranslations('Broadcasts.wizard');
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [loadingFields, setLoadingFields] = useState(true);
  const [firstContact, setFirstContact] = useState<Contact | null>(null);
  const [firstContactCustomValues, setFirstContactCustomValues] = useState<
    Map<string, string>
  >(new Map());
  const [loadingPreview, setLoadingPreview] = useState(true);

  // Load user's custom fields + a representative contact for the
  // live preview. Fall back to sample data if no contacts exist yet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const [fieldsRes, contactRes] = await Promise.all([
        supabase.from('custom_fields').select('*').order('field_name'),
        supabase
          .from('contacts')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (cancelled) return;

      setCustomFields(fieldsRes.data ?? []);
      setLoadingFields(false);

      const contact = contactRes.data ?? null;
      setFirstContact(contact);

      if (contact) {
        const { data: customVals } = await supabase
          .from('contact_custom_values')
          .select('custom_field_id, value')
          .eq('contact_id', contact.id);
        if (!cancelled) {
          const map = new Map<string, string>();
          for (const row of customVals ?? []) {
            map.set(row.custom_field_id, row.value ?? '');
          }
          setFirstContactCustomValues(map);
        }
      }
      setLoadingPreview(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const placeholders = useMemo(() => {
    const matches = template.body_text.match(/\{\{(\d+)\}\}/g);
    if (!matches) return [];
    return [...new Set(matches)].sort();
  }, [template.body_text]);

  // Templates with an IMAGE/VIDEO/DOCUMENT header need a media URL at
  // send time — Meta requires the media component on every delivery and
  // rejects the broadcast without it. The field is hidden for text-only
  // headers.
  const mediaHeaderType = isMediaHeaderType(template.header_type)
    ? template.header_type
    : null;

  // Seed the field with the template's stored sample URL the first time
  // we land on a media-header template, so the common "reuse the
  // approved media" case needs no typing. Only seeds when empty to avoid
  // clobbering a URL the user already edited.
  useEffect(() => {
    if (mediaHeaderType && !headerMediaUrl && template.header_media_url) {
      onHeaderMediaUrlChange(template.header_media_url);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaHeaderType, template.header_media_url]);

  const headerMediaError = useMemo<'missing' | 'invalid' | null>(() => {
    if (!mediaHeaderType) return null;
    const value = headerMediaUrl.trim();
    if (!value) return 'missing';
    if (!isValidHttpUrl(value)) return 'invalid';
    return null;
  }, [mediaHeaderType, headerMediaUrl]);

  /**
   * A placeholder is "unmapped" if the user hasn't picked either a
   * static value or a field/custom-field source. Blocks Next until
   * every placeholder has something — otherwise the broadcast would
   * ship with empty strings and confuse recipients.
   */
  const unmappedKeys = useMemo(() => {
    const missing: string[] = [];
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      if (
        !mapping ||
        !mapping.value?.trim() ||
        (mapping.type !== 'static' &&
          (!broadcastFallbackText(mapping).trim() ||
            missingVariableFallbacks(broadcastFallbackText(mapping)).length >
              0))
      ) {
        missing.push(placeholder);
      }
    }
    return missing;
  }, [placeholders, variables]);

  function updateVariable(key: string, patch: Partial<VariableMapping>) {
    const current = variables[key] ?? {
      type: 'static' as VariableType,
      value: '',
    };
    onUpdate({
      ...variables,
      [key]: { ...current, ...patch } as VariableMapping,
    });
  }

  /**
   * Substitute placeholders using the first real contact where
   * possible. Placeholders keyed by "{{N}}" map to variable key "N".
   */
  const previewText = useMemo(() => {
    const contact = firstContact ?? SAMPLE_CONTACT;
    const customValues = firstContact
      ? firstContactCustomValues
      : new Map<string, string>();

    let text = template.body_text;
    for (const placeholder of placeholders) {
      const key = placeholder.replace(/^\{\{|\}\}$/g, '');
      const mapping = variables[key];
      // Same resolution as the send (fallback included). A placeholder
      // that still resolves empty stays visible as {{N}} — that contact
      // would be rejected by Meta.
      const resolved = mapping?.value
        ? resolveVariable(mapping, contact, customValues)
        : '';
      text = text.replaceAll(placeholder, resolved || placeholder);
    }
    return text;
  }, [
    template.body_text,
    variables,
    placeholders,
    firstContact,
    firstContactCustomValues,
  ]);

  const previewLabel = firstContact
    ? firstContact.name || firstContact.phone
    : t('personalize.previewSample');

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-foreground text-lg font-semibold">
          {t('personalize.title')}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {t('personalize.subtitle')}
        </p>
      </div>

      {mediaHeaderType && (
        <div className="border-border bg-card/50 rounded-xl border p-4">
          <div className="mb-3 flex items-center gap-2">
            <ImageIcon className="text-primary h-4 w-4" />
            <p className="text-foreground text-sm font-medium">
              {t('personalize.headerImage')}
            </p>
            <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium uppercase">
              {mediaHeaderType}
            </span>
          </div>
          <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
            {t('personalize.imageUrl')}
          </label>
          <Input
            type="url"
            value={headerMediaUrl}
            onChange={(e) => onHeaderMediaUrlChange(e.target.value)}
            placeholder={t('personalize.imageUrlPlaceholder')}
            className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
          />
          <p className="text-muted-foreground mt-1.5 text-xs">
            {t('personalize.headerImageDesc')}
          </p>
          {headerMediaError && (
            <p className="mt-1.5 text-xs text-amber-300">
              {headerMediaError === 'missing'
                ? 'A media URL is required to send this template.'
                : 'Enter a valid http(s) URL.'}
            </p>
          )}
        </div>
      )}

      {placeholders.length === 0 && !mediaHeaderType ? (
        <div className="border-border bg-card/50 rounded-xl border p-6 text-center">
          <p className="text-muted-foreground text-sm">
            {t('personalize.noPreview')}
          </p>
        </div>
      ) : placeholders.length === 0 ? null : (
        <div className="space-y-4">
          {placeholders.map((placeholder) => {
            const key = placeholder.replace(/^\{\{|\}\}$/g, '');
            const mapping = variables[key] ?? { type: 'static', value: '' };

            return (
              <div
                key={placeholder}
                className="border-border bg-card/50 rounded-xl border p-4"
              >
                <div className="mb-3 flex items-center gap-2">
                  <span className="bg-primary/10 text-primary inline-flex items-center rounded-md px-2 py-0.5 font-mono text-xs font-medium">
                    {placeholder}
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                      {t('personalize.type')}
                    </label>
                    <Select
                      value={mapping.type}
                      onValueChange={(val) =>
                        updateVariable(key, {
                          type: val as VariableType,
                          value: '',
                        })
                      }
                    >
                      <SelectTrigger className="border-border bg-muted text-foreground w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="border-border bg-popover">
                        <SelectItem value="static">
                          {t('personalize.typeStatic')}
                        </SelectItem>
                        <SelectItem value="field">
                          {t('personalize.typeContact')}
                        </SelectItem>
                        <SelectItem value="custom_field">
                          {t('personalize.typeCustom')}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                      {mapping.type === 'static'
                        ? t('personalize.staticValue')
                        : t('personalize.contactField')}
                    </label>
                    {mapping.type === 'static' ? (
                      <Input
                        value={mapping.value}
                        onChange={(e) =>
                          updateVariable(key, { value: e.target.value })
                        }
                        placeholder="Enter value..."
                        className="border-border bg-muted text-foreground placeholder:text-muted-foreground"
                      />
                    ) : mapping.type === 'field' ? (
                      <Select
                        value={mapping.value || undefined}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="border-border bg-muted text-foreground w-full">
                          <SelectValue
                            placeholder={t('personalize.selectContactField')}
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {contactFields.map((field) => (
                            <SelectItem key={field.value} value={field.value}>
                              {t(`personalize.fieldMap.${field.labelKey}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Select
                        value={mapping.value || undefined}
                        onValueChange={(val) =>
                          updateVariable(key, { value: val || '' })
                        }
                      >
                        <SelectTrigger className="border-border bg-muted text-foreground w-full">
                          <SelectValue
                            placeholder={
                              loadingFields
                                ? 'Loading…'
                                : customFields.length === 0
                                  ? 'No custom fields'
                                  : 'Select custom field…'
                            }
                          />
                        </SelectTrigger>
                        <SelectContent className="border-border bg-popover">
                          {customFields.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.field_name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                {mapping.type !== 'static' && (
                  <div className="mt-3">
                    <label className="text-muted-foreground mb-1.5 block text-xs font-medium">
                      {t('personalize.fallback')} *
                    </label>
                    <BroadcastFallbackInput
                      mapping={mapping}
                      customFields={customFields}
                      onChange={(fallback) =>
                        updateVariable(key, {
                          fallback,
                          fallbackType: 'static',
                        })
                      }
                      placeholder={t('personalize.fallbackPlaceholder')}
                      label={t('personalize.fallback')}
                    />
                    <p className="text-muted-foreground mt-1.5 text-xs">
                      {t('personalize.fallbackDesc')}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Live Preview — mobile mockup approximating the recipient view. */}
      <div className="border-border bg-card/50 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <Eye className="text-primary h-4 w-4" />
          <p className="text-foreground text-sm font-medium">
            {t('personalize.preview')}
          </p>
          <span className="text-muted-foreground text-xs">
            ({previewLabel})
          </span>
          {loadingPreview && (
            <Loader2 className="text-primary h-3.5 w-3.5 animate-spin" />
          )}
        </div>
        <TemplateMobilePreview
          bodyText={previewText}
          headerType={template.header_type}
          headerContent={template.header_content}
          headerMediaUrl={
            mediaHeaderType
              ? headerMediaUrl.trim() || template.header_media_url
              : null
          }
          footerText={template.footer_text}
          buttons={normalizeTemplateButtons(template.buttons)}
        />
      </div>

      {unmappedKeys.length > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          Map every placeholder before continuing — still missing{' '}
          <span className="font-mono font-semibold">
            {unmappedKeys.join(', ')}
          </span>
          . Otherwise those placeholders will ship to Meta as empty strings.
        </div>
      )}

      <div className="border-border flex items-center justify-between border-t pt-4">
        <Button
          variant="outline"
          onClick={onBack}
          className="border-border text-muted-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        <Button
          onClick={onNext}
          disabled={unmappedKeys.length > 0 || headerMediaError !== null}
          className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t('next')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
