"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
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
import { extractVariableIndices } from "@/lib/whatsapp/template-validators";
import type { MessageTemplate } from "@/types";
import type { TemplateVariableGroup } from "@/lib/flows/template-variables";
import {
  quickReplyButtonsFromTemplate,
  syncTemplateButtonConfig,
  configQuickReplyIdsKey,
  normalizeTemplateButtons,
  type TemplateQuickReplyButton,
} from "@/lib/flows/template-buttons";
import { TemplateVariablePicker } from "@/components/shared/template-variable-picker";
import { NextNodeRow } from "@/components/flows/forms/fields";
import type { BuilderNode } from "@/components/flows/shared";

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
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => {
    setReloadToken((n) => n + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("message_templates")
        .select("*")
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
  }, [reloadToken]);

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
  variableHint = "Click a variable on the right or type {{ vars.field }} manually.",
  variableGroups = [],
}: SendTemplateFieldsProps) {
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
    if (!templateName) {
      setFreshTemplate(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      const supabase = createClient();
      const { data: rows } = await supabase
        .from("message_templates")
        .select("*")
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
  }, [templateName, lang]);

  const placeholders = useMemo(
    () => (selectedTemplate ? bodyPlaceholders(selectedTemplate.body_text) : []),
    [selectedTemplate],
  );

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
    const field = activeField ?? placeholders[0] ?? "header_1";
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
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-medium text-foreground">Preview</p>
              <Badge
                variant="outline"
                className="border-primary/30 text-[10px] text-primary"
              >
                {selectedTemplate.category}
              </Badge>
            </div>
            {selectedTemplate.header_type === "text" &&
              selectedTemplate.header_content && (
                <p className="mb-1 text-sm font-semibold text-foreground">
                  {selectedTemplate.header_content.replace(
                    /\{\{(\d+)\}\}/g,
                    (_, n) => variables[`header_${n}`]?.trim() || `{{${n}}}`,
                  )}
                </p>
              )}
            <p className="whitespace-pre-wrap text-sm text-foreground">
              {renderPreviewBody(selectedTemplate.body_text, variables)}
            </p>
            {selectedTemplate.footer_text && (
              <p className="mt-2 text-xs italic text-muted-foreground">
                {selectedTemplate.footer_text}
              </p>
            )}
            {hasQuickReplies && (
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Quick reply buttons
                </p>
                {quickReplies.map((b) => (
                  <div
                    key={b.reply_id}
                    className="rounded border border-border bg-background/60 px-2 py-1 text-center text-xs text-foreground"
                  >
                    {b.title}
                  </div>
                ))}
              </div>
            )}
            {!hasQuickReplies && otherButtons.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-border pt-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Template buttons (URL / call — no branch)
                </p>
                {otherButtons.map((b) => (
                  <div
                    key={`${b.type}-${b.text}`}
                    className="rounded border border-dashed border-border bg-background/40 px-2 py-1 text-center text-xs text-muted-foreground"
                  >
                    {b.text} ({b.type.replace("_", " ").toLowerCase()})
                  </div>
                ))}
                <p className="text-[10px] text-muted-foreground">
                  Only quick-reply buttons can branch the flow. Re-sync templates
                  in Settings → Templates if quick replies are missing.
                </p>
              </div>
            )}
            {!hasQuickReplies &&
              otherButtons.length === 0 &&
              selectedTemplate &&
              !normalizeTemplateButtons(selectedTemplate.buttons).length && (
                <div className="mt-2 space-y-2">
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
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="space-y-2">
                <p className="text-[11px] text-muted-foreground">{variableHint}</p>
                {placeholders.map((key) => (
                  <div key={key}>
                    <label className="mb-1 block text-xs text-muted-foreground">
                      Variable {`{{${key}}}`}
                    </label>
                    <Input
                      value={variables[key] ?? ""}
                      onFocus={() => setActiveField(key)}
                      onChange={(e) =>
                        onChange({
                          template_name: templateName,
                          language: lang,
                          variables: { ...variables, [key]: e.target.value },
                        })
                      }
                      placeholder="Select from the list →"
                      className={cn(
                        "bg-muted font-mono text-xs",
                        activeField === key && "ring-1 ring-primary",
                      )}
                    />
                  </div>
                ))}

                {selectedTemplate.header_type === "text" &&
                  selectedTemplate.header_content &&
                  extractVariableIndices(selectedTemplate.header_content).length > 0 && (
                    <div>
                      <label className="mb-1 block text-xs text-muted-foreground">
                        Header variable
                      </label>
                      <Input
                        value={variables.header_1 ?? ""}
                        onFocus={() => setActiveField("header_1")}
                        onChange={(e) =>
                          onChange({
                            template_name: templateName,
                            language: lang,
                            variables: { ...variables, header_1: e.target.value },
                          })
                        }
                        placeholder="Header {{1}} value"
                        className={cn(
                          "bg-muted font-mono text-xs",
                          activeField === "header_1" && "ring-1 ring-primary",
                        )}
                      />
                    </div>
                  )}
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
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_11rem]">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Header variable
                  </label>
                  <Input
                    value={variables.header_1 ?? ""}
                    onFocus={() => setActiveField("header_1")}
                    onChange={(e) =>
                      onChange({
                        template_name: templateName,
                        language: lang,
                        variables: { ...variables, header_1: e.target.value },
                      })
                    }
                    placeholder="Header {{1}} value"
                    className={cn(
                      "bg-muted font-mono text-xs",
                      activeField === "header_1" && "ring-1 ring-primary",
                    )}
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

          {!hasQuickReplies && allNodes.length > 0 && (
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
              label="Advances to"
            />
          )}
        </>
      )}
    </div>
  );
}
