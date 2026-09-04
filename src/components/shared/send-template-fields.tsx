"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import type { MessageTemplate } from "@/types";
import type { TemplateVariableGroup } from "@/lib/flows/template-variables";
import {
  quickReplyButtonsFromTemplate,
  syncTemplateButtonConfig,
  configQuickReplyIdsKey,
  normalizeTemplateButtons,
  urlButtonsNeedingSuffix,
  type TemplateQuickReplyButton,
} from "@/lib/flows/template-buttons";
import { TemplateVariablePicker } from "@/components/shared/template-variable-picker";
import { TemplateMobilePreview } from "@/components/shared/template-mobile-preview";
import { NextNodeRow } from "@/components/flows/forms/fields";
import type { BuilderNode } from "@/components/flows/shared";
import {
  MEDIA_MAX_BYTES_BY_KIND,
  uploadAccountMedia,
} from "@/lib/storage/upload-media";

export interface SendTemplateFieldsValue {
  template_name: string;
  language: string;
  variables?: Record<string, string>;
  buttons?: TemplateQuickReplyButton[];
  next_node_key?: string;
}

interface SendTemplateFieldsProps {
  templateName: string;
  language: string;
  variables?: Record<string, string>;
  buttons?: TemplateQuickReplyButton[];
  nextNodeKey?: string;
  allNodes?: BuilderNode[];
  currentNodeKey?: string;
  onChange: (patch: SendTemplateFieldsValue) => void;
  /** Extra hint shown above variable inputs (flows vs automations). */
  variableHint?: string;
  /** Grouped variables for the picker sidebar. */
  variableGroups?: TemplateVariableGroup[];
}

function toOptionValue(name: string, lang: string) {
  return `${name}::${lang}`;
}

function fromOptionValue(value: string): { name: string; lang: string } {
  const [name, lang] = value.split("::");
  return { name: name ?? "", lang: lang ?? "en_US" };
}

function bodyPlaceholders(body: string): string[] {
  const matches = body.match(/\{\{\d+\}\}/g) ?? [];
  return [...new Set(matches)]
    .sort((a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, "")))
    .map((m) => m.replace(/^\{\{|\}\}$/g, ""));
}

const MEDIA_HEADER_TYPES = ["image", "video", "document"] as const;
type MediaHeaderType = (typeof MEDIA_HEADER_TYPES)[number];

function isMediaHeaderType(value: unknown): value is MediaHeaderType {
  return MEDIA_HEADER_TYPES.includes(value as MediaHeaderType);
}

function isStaticMediaUrl(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !trimmed.includes("{{");
}

function HeaderMediaField({
  mediaHeaderType,
  value,
  active,
  onFocus,
  onChange,
}: {
  mediaHeaderType: MediaHeaderType;
  value: string;
  active: boolean;
  onFocus: () => void;
  onChange: (url: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleHeaderImageFile(file: File) {
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      toast.error("Header image must be a JPEG or PNG.");
      return;
    }
    if (file.size > MEDIA_MAX_BYTES_BY_KIND.image) {
      toast.error(
        `Image is ${(file.size / 1024 / 1024).toFixed(1)} MB — Meta's limit is 5 MB.`,
      );
      return;
    }
    setUploading(true);
    try {
      const { publicUrl } = await uploadAccountMedia("chat-media", file);
      onChange(publicUrl);
      toast.success("Image uploaded.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {mediaHeaderType === "image" && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleHeaderImageFile(file);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Upload image
          </Button>
          <span className="text-[10px] text-muted-foreground">
            JPEG or PNG, ≤5 MB — or paste a public URL / variable below
          </span>
        </div>
      )}
      <label className="mb-1 block text-xs text-muted-foreground">
        Header media URL ({mediaHeaderType})
      </label>
      <Input
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder="{{ vars.product_image }} or https://…"
        className={variableInputClass(active)}
      />
      {mediaHeaderType === "image" &&
        isStaticMediaUrl(value) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value.trim()}
            alt="Header preview"
            className="mt-2 max-h-28 rounded-md border border-border object-contain"
          />
        )}
      <p className="mt-1 text-[10px] text-muted-foreground">
        Public URL sent as the template header at send time. Upload a JPEG/PNG
        for a static image, map{" "}
        <span className="font-mono">Product image</span> from trigger attributes
        for Shopify orders, or paste any public HTTPS link.
      </p>
    </div>
  );
}

/** Side-by-side variable inputs + picker when the panel is wide enough. */
const VARIABLE_FIELDS_LAYOUT =
  "grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_min(100%,240px)]";

function variableInputClass(active: boolean) {
  return cn(
    "h-auto min-h-8 w-full min-w-0 bg-muted py-1.5 font-mono text-xs leading-normal",
    active && "ring-1 ring-primary",
  );
}

function VariableMappingInput({
  value,
  onChange,
  onFocus,
  active,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus: () => void;
  active: boolean;
  placeholder?: string;
}) {
  return (
    <textarea
      rows={value.length > 36 ? 2 : 1}
      value={value}
      title={value}
      onFocus={onFocus}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        variableInputClass(active),
        "resize-none break-all rounded-lg border border-input outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    />
  );
}

function renderPreviewBody(
  body: string,
  variables: Record<string, string>,
): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const raw = variables[n]?.trim();
    if (!raw) return `{{${n}}}`;
    const varsRef = raw.match(/\{\{\s*vars\.([\w.]+)\s*\}\}/);
    if (varsRef) return `[${varsRef[1]}]`;
    const triggerRef = raw.match(/\{\{\s*trigger\.([\w.]+)\s*\}\}/);
    if (triggerRef) return `[${triggerRef[1]}]`;
    return raw;
  });
}

function useApprovedTemplates() {
  const { accountId } = useAuth();
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!accountId) {
        setTemplates([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
        .eq("account_id", accountId)
        .eq("status", "APPROVED")
        .order("name");

      if (cancelled) return;
      if (error) {
        console.error("Failed to load templates:", error);
        setTemplates([]);
      } else {
        setTemplates((data as MessageTemplate[]) ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [reloadToken, accountId]);

  return { templates, loading, reload };
}

export function SendTemplateFields({
  templateName,
  language,
  variables = {},
  buttons = [],
  nextNodeKey = "",
  allNodes = [],
  currentNodeKey = "",
  onChange,
  variableHint = "Click a variable on the right or type {{ vars.field }} manually. Use Fallback options when a field may be empty.",
  variableGroups = [],
}: SendTemplateFieldsProps) {
  const { accountId } = useAuth();
  const { templates, loading, reload } = useApprovedTemplates();
  const lang = language || "en_US";
  const [activeField, setActiveField] = useState<string | null>(null);
  const [freshTemplate, setFreshTemplate] = useState<MessageTemplate | null>(null);
  const [syncing, setSyncing] = useState(false);

  const selectedTemplate = useMemo(() => {
    const fromList =
      templates.find(
        (t) => t.name === templateName && (t.language ?? "en_US") === lang,
      ) ?? null;
    if (
      freshTemplate &&
      freshTemplate.name === templateName &&
      (freshTemplate.language ?? "en_US") === lang
    ) {
      return freshTemplate;
    }
    return fromList;
  }, [templates, templateName, lang, freshTemplate]);

  useEffect(() => {
    if (!templateName || !accountId) {
      setFreshTemplate(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("message_templates")
        .select("*")
        .eq("account_id", accountId)
        .eq("name", templateName)
        .eq("status", "APPROVED");
      const data =
        (rows as MessageTemplate[] | null)?.find(
          (t) => (t.language ?? "en_US") === lang,
        ) ?? null;
      if (!cancelled) {
        setFreshTemplate(data);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateName, lang, accountId]);

  const placeholders = useMemo(
    () => (selectedTemplate ? bodyPlaceholders(selectedTemplate.body_text) : []),
    [selectedTemplate],
  );

  const mediaHeaderType = isMediaHeaderType(selectedTemplate?.header_type)
    ? selectedTemplate!.header_type
    : null;

  // Seed header media for IMAGE/VIDEO/DOCUMENT templates. Prefer the
  // Shopify product image token when available; otherwise reuse the
  // template sample URL (same idea as broadcast personalization).
  useEffect(() => {
    if (!selectedTemplate || !mediaHeaderType) return;
    if (variables.header_media?.trim()) return;

    const hasProductImage = variableGroups.some((g) =>
      g.options.some((o) => o.token.includes("vars.product_image")),
    );
    const seed = hasProductImage
      ? "{{ vars.product_image }}"
      : selectedTemplate.header_media_url?.trim() || "";
    if (!seed) return;

    onChange({
      template_name: templateName,
      language: lang,
      variables: { ...variables, header_media: seed },
      buttons,
      next_node_key: nextNodeKey,
    });
    // Only re-run when the template / trigger vars change — avoid
    // clobbering a URL the user already cleared or edited.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaHeaderType, selectedTemplate?.id, variableGroups]);

  const urlSuffixButtons = useMemo(
    () => urlButtonsNeedingSuffix(selectedTemplate),
    [selectedTemplate],
  );

  // Shopify fulfillment: platform tracking redirect for URL buttons.
  // Other order triggers: Shopify order-status suffix. Only seed empty slots.
  useEffect(() => {
    if (!selectedTemplate || urlSuffixButtons.length === 0) return;
    const hasTrackingRedirect = variableGroups.some((g) =>
      g.options.some((o) => o.token.includes("vars.tracking_url_redirect_suffix")),
    );
    const hasStatusSuffix = variableGroups.some((g) =>
      g.options.some((o) => o.token.includes("vars.order_status_url_suffix")),
    );
    const preferredToken = hasTrackingRedirect
      ? "{{ vars.tracking_url_redirect_suffix }}"
      : hasStatusSuffix
        ? "{{ vars.order_status_url_suffix }}"
        : null;
    if (!preferredToken) return;

    const next = { ...variables };
    let changed = false;
    for (const slot of urlSuffixButtons) {
      const key = `button_${slot.index}`;
      if (next[key]?.trim()) continue;
      next[key] = preferredToken;
      changed = true;
    }
    if (!changed) return;
    onChange({
      template_name: templateName,
      language: lang,
      variables: next,
      buttons,
      next_node_key: nextNodeKey,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTemplate?.id, urlSuffixButtons, variableGroups]);

  const buttonBranches = useMemo(
    () =>
      selectedTemplate
        ? syncTemplateButtonConfig(buttons, selectedTemplate)
        : buttons,
    [selectedTemplate, buttons],
  );

  const quickReplies = useMemo(
    () =>
      selectedTemplate
        ? quickReplyButtonsFromTemplate(selectedTemplate)
        : buttonBranches.map((b) => ({ reply_id: b.reply_id, title: b.title })),
    [selectedTemplate, buttonBranches],
  );

  const hasQuickReplies = quickReplies.length > 0;
  const otherButtons = useMemo(
    () =>
      selectedTemplate
        ? normalizeTemplateButtons(selectedTemplate.buttons).filter(
            (b) => b.type !== "QUICK_REPLY",
          )
        : [],
    [selectedTemplate],
  );

  useEffect(() => {
    if (!selectedTemplate) return;
    const synced = syncTemplateButtonConfig(buttons, selectedTemplate);
    if (configQuickReplyIdsKey(buttons) === configQuickReplyIdsKey(synced)) {
      return;
    }
    onChange({
      template_name: templateName,
      language: lang,
      variables,
      buttons: synced,
      next_node_key: nextNodeKey,
    });
  }, [selectedTemplate, templateName, lang, variables, nextNodeKey, buttons]);

  const syncTemplatesFromMeta = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/whatsapp/templates/sync", { method: "POST" });
      const body = (await res.json()) as { error?: string; updated?: number; inserted?: number };
      if (!res.ok) {
        throw new Error(body.error ?? "Sync failed");
      }
      reload();
      if (templateName) {
        const supabase = createClient();
        const { data: rows } = await supabase
          .from("message_templates")
          .select("*")
          .eq("account_id", accountId)
          .eq("name", templateName)
          .eq("status", "APPROVED");
        const data =
          (rows as MessageTemplate[] | null)?.find(
            (t) => (t.language ?? "en_US") === lang,
          ) ?? null;
        setFreshTemplate(data);
        if (data) {
          const synced = syncTemplateButtonConfig(buttons, data);
          onChange({
            template_name: templateName,
            language: lang,
            variables,
            buttons: synced,
            next_node_key: nextNodeKey,
          });
        }
      }
      toast.success("Templates synced from Meta");
    } catch (err) {
      console.error("Template sync failed:", err);
      toast.error(err instanceof Error ? err.message : "Template sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const templateOptionLabel = (t: MessageTemplate) => {
    const tLang = t.language ?? "en_US";
    const qrCount = quickReplyButtonsFromTemplate(t).length;
    const suffix =
      qrCount > 0
        ? ` · ${qrCount} quick repl${qrCount === 1 ? "y" : "ies"}`
        : normalizeTemplateButtons(t.buttons).length > 0
          ? " · URL/CTA buttons only"
          : "";
    return `${t.name} (${tLang})${suffix}`;
  };

  const insertToken = (token: string) => {
    const field =
      activeField ??
      placeholders[0] ??
      (isMediaHeaderType(selectedTemplate?.header_type)
        ? "header_media"
        : "header_1");
    if (!field) return;
    onChange({
      template_name: templateName,
      language: lang,
      variables: { ...variables, [field]: token },
    });
  };

  const currentValue = templateName ? toOptionValue(templateName, lang) : "";
  const hasMatch = templates.some(
    (t) => toOptionValue(t.name, t.language ?? "en_US") === currentValue,
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading templates…
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="space-y-3">
        <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          No approved templates found. Sync templates from Settings → Templates
          after approving them in Meta.
        </p>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">
            Template name
          </label>
          <Input
            value={templateName}
            onChange={(e) =>
              onChange({ template_name: e.target.value, language: lang, variables })
            }
            placeholder="template_name"
            className="bg-muted"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Language</label>
          <Input
            value={lang}
            onChange={(e) =>
              onChange({
                template_name: templateName,
                language: e.target.value,
                variables,
              })
            }
            placeholder="en_US"
            className="bg-muted"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Template</label>
        <Select
          value={currentValue || undefined}
          onValueChange={(v) => {
            if (!v) return;
            const { name, lang: nextLang } = fromOptionValue(v);
            const tpl = templates.find(
              (t) => t.name === name && (t.language ?? "en_US") === nextLang,
            );
            onChange({
              template_name: name,
              language: nextLang,
              variables: {},
              buttons: tpl ? syncTemplateButtonConfig(buttons, tpl) : [],
              next_node_key: nextNodeKey,
            });
          }}
        >
          <SelectTrigger className="bg-muted">
            <SelectValue placeholder="Select a template…" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((t) => (
              <SelectItem key={t.id} value={toOptionValue(t.name, t.language ?? "en_US")}>
                {templateOptionLabel(t)}
              </SelectItem>
            ))}
            {currentValue && !hasMatch && (
              <SelectItem value={currentValue}>
                {templateName} ({lang}) — not in list
              </SelectItem>
            )}
          </SelectContent>
        </Select>
      </div>

      {selectedTemplate && (
        <>
          <div className="rounded-md border border-border bg-muted/30 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-foreground">Preview</p>
              <Badge
                variant="outline"
                className="border-primary/30 text-[10px] text-primary"
              >
                {selectedTemplate.category}
              </Badge>
              <span className="text-[10px] text-muted-foreground">
                As seen on customer&apos;s phone
              </span>
            </div>
            <TemplateMobilePreview
              bodyText={renderPreviewBody(selectedTemplate.body_text, variables)}
              headerType={selectedTemplate.header_type}
              headerContent={
                selectedTemplate.header_type === "text" &&
                selectedTemplate.header_content
                  ? selectedTemplate.header_content.replace(
                      /\{\{(\d+)\}\}/g,
                      (_, n) => variables[`header_${n}`]?.trim() || `{{${n}}}`,
                    )
                  : null
              }
              headerMediaUrl={
                isMediaHeaderType(selectedTemplate.header_type)
                  ? variables.header_media?.match(/^\{\{\s*vars\.[\w.]+\s*\}\}$/)
                    ? selectedTemplate.header_media_url ?? null
                    : variables.header_media?.trim() ||
                      selectedTemplate.header_media_url ||
                      null
                  : null
              }
              footerText={selectedTemplate.footer_text}
              buttons={normalizeTemplateButtons(selectedTemplate.buttons)}
            />
            {!hasQuickReplies && otherButtons.length > 0 && (
              <p className="mt-3 text-[10px] text-muted-foreground">
                Only quick-reply buttons can branch the flow. Re-sync templates
                in Settings → Templates if quick replies are missing.
              </p>
            )}
            {!hasQuickReplies &&
              otherButtons.length === 0 &&
              selectedTemplate &&
              !normalizeTemplateButtons(selectedTemplate.buttons).length && (
                <div className="mt-3 space-y-2">
                  <p className="text-[10px] text-muted-foreground">
                    This template has no quick-reply buttons, so the flow can only
                    continue to one next step after send. Pick a template with
                    quick replies in the list above, or add them in Meta Business
                    Manager and sync.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={syncing}
                    onClick={() => void syncTemplatesFromMeta()}
                  >
                    {syncing ? (
                      <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                    )}
                    Sync templates from Meta
                  </Button>
                </div>
              )}
          </div>

          {placeholders.length > 0 && (
            <div className={VARIABLE_FIELDS_LAYOUT}>
              <div className="min-w-0 space-y-2">
                <p className="text-[11px] text-muted-foreground">{variableHint}</p>
                {placeholders.map((key) => (
                  <div key={key} className="min-w-0">
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Variable {`{{${key}}}`}
                    </label>
                    <VariableMappingInput
                      value={variables[key] ?? ""}
                      onFocus={() => setActiveField(key)}
                      onChange={(next) =>
                        onChange({
                          template_name: templateName,
                          language: lang,
                          variables: { ...variables, [key]: next },
                        })
                      }
                      placeholder="Select from the list →"
                      active={activeField === key}
                    />
                  </div>
                ))}

                {mediaHeaderType && (
                  <HeaderMediaField
                    mediaHeaderType={mediaHeaderType}
                    value={variables.header_media ?? ""}
                    active={activeField === "header_media"}
                    onFocus={() => setActiveField("header_media")}
                    onChange={(header_media) =>
                      onChange({
                        template_name: templateName,
                        language: lang,
                        variables: { ...variables, header_media },
                      })
                    }
                  />
                )}

                {selectedTemplate.header_type === "text" &&
                  selectedTemplate.header_content &&
                  extractVariableIndices(selectedTemplate.header_content).length > 0 && (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Header variable
                      </label>
                      <VariableMappingInput
                        value={variables.header_1 ?? ""}
                        onFocus={() => setActiveField("header_1")}
                        onChange={(next) =>
                          onChange({
                            template_name: templateName,
                            language: lang,
                            variables: { ...variables, header_1: next },
                          })
                        }
                        placeholder="Header {{1}} value"
                        active={activeField === "header_1"}
                      />
                    </div>
                  )}

                {urlSuffixButtons.map((slot) => (
                  <div key={`button_${slot.index}`}>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      URL button “{slot.text}” — suffix for {`{{1}}`}
                    </label>
                    <VariableMappingInput
                      value={variables[`button_${slot.index}`] ?? ""}
                      onFocus={() => setActiveField(`button_${slot.index}`)}
                      onChange={(next) =>
                        onChange({
                          template_name: templateName,
                          language: lang,
                          variables: {
                            ...variables,
                            [`button_${slot.index}`]: next,
                          },
                        })
                      }
                      placeholder="{{ vars.tracking_url_redirect_suffix }}"
                      active={activeField === `button_${slot.index}`}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Static part of the button URL stays in the template. This
                      value replaces {`{{1}}`} at send time.
                    </p>
                  </div>
                ))}
              </div>

              {variableGroups.length > 0 && (
                <TemplateVariablePicker
                  groups={variableGroups}
                  onInsert={insertToken}
                  className="lg:sticky lg:top-0"
                />
              )}
            </div>
          )}

          {placeholders.length === 0 &&
            selectedTemplate.header_type === "text" &&
            selectedTemplate.header_content &&
            extractVariableIndices(selectedTemplate.header_content).length > 0 && (
              <div className={VARIABLE_FIELDS_LAYOUT}>
                <div className="min-w-0">
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Header variable
                  </label>
                  <VariableMappingInput
                    value={variables.header_1 ?? ""}
                    onFocus={() => setActiveField("header_1")}
                    onChange={(next) =>
                      onChange({
                        template_name: templateName,
                        language: lang,
                        variables: { ...variables, header_1: next },
                      })
                    }
                    placeholder="Header {{1}} value"
                    active={activeField === "header_1"}
                  />
                </div>
                {variableGroups.length > 0 && (
                  <TemplateVariablePicker
                    groups={variableGroups}
                    onInsert={insertToken}
                  />
                )}
              </div>
            )}

          {placeholders.length === 0 && mediaHeaderType && (
            <div className={VARIABLE_FIELDS_LAYOUT}>
              <div className="min-w-0">
                <HeaderMediaField
                  mediaHeaderType={mediaHeaderType}
                  value={variables.header_media ?? ""}
                  active={activeField === "header_media"}
                  onFocus={() => setActiveField("header_media")}
                  onChange={(header_media) =>
                    onChange({
                      template_name: templateName,
                      language: lang,
                      variables: { ...variables, header_media },
                    })
                  }
                />
              </div>
              {variableGroups.length > 0 && (
                <TemplateVariablePicker
                  groups={variableGroups}
                  onInsert={insertToken}
                />
              )}
            </div>
          )}

          {placeholders.length === 0 && urlSuffixButtons.length > 0 && (
            <div className={VARIABLE_FIELDS_LAYOUT}>
              <div className="min-w-0 space-y-2">
                {urlSuffixButtons.map((slot) => (
                  <div key={`button_${slot.index}`}>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      URL button “{slot.text}” — suffix for {`{{1}}`}
                    </label>
                    <VariableMappingInput
                      value={variables[`button_${slot.index}`] ?? ""}
                      onFocus={() => setActiveField(`button_${slot.index}`)}
                      onChange={(next) =>
                        onChange({
                          template_name: templateName,
                          language: lang,
                          variables: {
                            ...variables,
                            [`button_${slot.index}`]: next,
                          },
                        })
                      }
                      placeholder="{{ vars.tracking_url_redirect_suffix }}"
                      active={activeField === `button_${slot.index}`}
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Static part of the button URL stays in the template. This
                      value replaces {`{{1}}`} at send time.
                    </p>
                  </div>
                ))}
              </div>
              {variableGroups.length > 0 && (
                <TemplateVariablePicker
                  groups={variableGroups}
                  onInsert={insertToken}
                />
              )}
            </div>
          )}

          {hasQuickReplies && allNodes.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] text-muted-foreground">
                Wire each quick-reply button to a different next step (drag from
                the canvas handles too).
              </p>
              {buttonBranches.map((b, i) => (
                <NextNodeRow
                  key={b.reply_id}
                  value={b.next_node_key ?? ""}
                  allNodes={allNodes}
                  currentKey={currentNodeKey}
                  onChange={(v) =>
                    onChange({
                      template_name: templateName,
                      language: lang,
                      variables,
                      buttons: buttonBranches.map((btn, j) =>
                        j === i ? { ...btn, next_node_key: v } : btn,
                      ),
                      next_node_key: nextNodeKey,
                    })
                  }
                  label={`“${b.title}” →`}
                />
              ))}
            </div>
          )}

          {allNodes.length > 0 && (
            <NextNodeRow
              value={nextNodeKey}
              allNodes={allNodes}
              currentKey={currentNodeKey}
              onChange={(v) =>
                onChange({
                  template_name: templateName,
                  language: lang,
                  variables,
                  buttons,
                  next_node_key: v,
                })
              }
              label={hasQuickReplies ? "Next step →" : "Advances to"}
            />
          )}
          {hasQuickReplies && (
            <p className="text-[10px] text-muted-foreground">
              Next step is optional when this template has quick-reply buttons.
              Connect it only if you need a path when the template sends without
              waiting for a tap.
            </p>
          )}
        </>
      )}
    </div>
  );
}
