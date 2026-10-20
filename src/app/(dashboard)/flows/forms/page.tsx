"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Plus,
  Save,
  Send,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";

import { useCan } from "@/hooks/use-can";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GatedButton } from "@/components/ui/gated-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  FLOW_CATEGORIES,
  FORM_FIELD_TYPE_LABELS,
  FORM_FIELD_TYPES,
  FORM_LIMITS,
  hasOptions,
  toFieldName,
  validateFormDefinition,
  type FormDefinition,
  type FormField,
  type FormFieldType,
  type FormIssue,
  type FormScreen,
} from "@/lib/whatsapp/form-builder";

/**
 * WhatsApp Forms designer — build Meta WhatsApp Flows (forms) in-app
 * instead of WhatsApp Manager. Published forms show up in the Send
 * WhatsApp Form node's picker, and answers land in
 * `{{vars.<var_key>.<field key>}}`.
 */

interface FormRow {
  id: string;
  name: string;
  category: string;
  definition: FormDefinition;
  meta_flow_id: string | null;
  meta_status: string | null;
  revision: number;
  previous_flow_ids: string[];
  has_unpublished_changes: boolean;
  last_error: string | null;
  published_at: string | null;
  updated_at: string;
}

interface MetaValidationError {
  message: string;
  error?: string;
  line_start?: number;
}


const CATEGORY_LABELS: Record<string, string> = {
  LEAD_GENERATION: "Lead generation",
  SIGN_UP: "Sign up",
  SIGN_IN: "Sign in",
  APPOINTMENT_BOOKING: "Appointment booking",
  CONTACT_US: "Contact us",
  CUSTOMER_SUPPORT: "Customer support",
  SURVEY: "Survey",
  OTHER: "Other",
};

function uniqueName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base.slice(0, FORM_LIMITS.name - 3)}_${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function allNames(def: FormDefinition, except?: FormField): Set<string> {
  return new Set(
    def.screens.flatMap((s) => s.fields.filter((f) => f !== except).map((f) => f.name)),
  );
}

function optionIds(titles: string[]): string[] {
  const taken = new Set<string>();
  return titles.map((t) => {
    const id = uniqueName(toFieldName(t || "option"), taken);
    taken.add(id);
    return id;
  });
}

function newField(type: FormFieldType, def: FormDefinition): FormField {
  const label = FORM_FIELD_TYPE_LABELS[type].replace(/ \(.*\)$/, "");
  const field: FormField = {
    type,
    label,
    name: uniqueName(toFieldName(label), allNames(def)),
    required: type !== "optin",
  };
  if (hasOptions(type)) {
    field.options = [
      { id: "option_1", title: "Option 1" },
      { id: "option_2", title: "Option 2" },
    ];
  }
  return field;
}

function statusBadge(form: FormRow) {
  if (form.meta_status === "PUBLISHED" && !form.has_unpublished_changes) {
    return <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">Published</Badge>;
  }
  if (form.meta_status === "PUBLISHED") {
    return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-300">Edited · not republished</Badge>;
  }
  if (form.meta_status === "DRAFT") {
    return <Badge variant="secondary">Draft on WhatsApp</Badge>;
  }
  return <Badge variant="outline">Not uploaded</Badge>;
}

export default function WhatsAppFormsPage() {
  const canEdit = useCan("send-messages");
  const [forms, setForms] = useState<FormRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/forms");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Load failed: ${res.status}`);
      setForms(json.forms as FormRow[]);
      setSelectedId((cur) => cur ?? (json.forms as FormRow[])[0]?.id ?? null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load forms");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/whatsapp/forms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: `New form ${forms.length + 1}` }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Create failed");
      setForms((cur) => [json.form as FormRow, ...cur]);
      setSelectedId(json.form.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Create failed");
    } finally {
      setCreating(false);
    }
  }

  const selected = forms.find((f) => f.id === selectedId) ?? null;
  const [actionsEl, setActionsEl] = useState<HTMLDivElement | null>(null);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* One slim row so the editor gets the height. */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            href="/flows"
            aria-label="Back to Flows"
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <h1
            className="truncate text-lg font-semibold text-foreground"
            title="Build the questions customers fill in inside WhatsApp, then send them with a Send WhatsApp Form step."
          >
            WhatsApp forms
          </h1>
        </div>
        {/* The selected form's Save / Upload / Publish / Delete render here. */}
        <div ref={setActionsEl} className="flex items-center gap-2" />
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="shrink-0 overflow-y-auto border-b p-3 md:w-64 md:border-r md:border-b-0">
          <div className="mb-3 [&>span]:flex">
            <GatedButton
              canAct={canEdit}
              gateReason="create forms"
              onClick={handleCreate}
              disabled={creating}
              className="w-full"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              New form
            </GatedButton>
          </div>
          {loading ? (
            <Loader2 className="m-4 h-5 w-5 animate-spin text-muted-foreground" />
          ) : forms.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              <ClipboardList className="mb-2 h-6 w-6" />
              No forms yet. Create one to collect names, dates, choices and more.
            </div>
          ) : (
            <ul className="space-y-1">
              {forms.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(f.id)}
                    className={cn(
                      "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-accent",
                      f.id === selectedId && "bg-accent",
                    )}
                  >
                    <div className="truncate font-medium">{f.name}</div>
                    <div className="mt-1">{statusBadge(f)}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        <main className="min-h-0 flex-1 overflow-y-auto">
          {selected ? (
            <FormEditor
              key={selected.id}
              form={selected}
              canEdit={canEdit}
              actionsEl={actionsEl}
              onChange={(row) => setForms((cur) => cur.map((f) => (f.id === row.id ? row : f)))}
              onDeleted={(id) => {
                setForms((cur) => cur.filter((f) => f.id !== id));
                setSelectedId(null);
              }}
            />
          ) : (
            !loading && (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                Select or create a form.
              </div>
            )
          )}
        </main>
      </div>
    </div>
  );
}

function FormEditor({
  form,
  canEdit,
  actionsEl,
  onChange,
  onDeleted,
}: {
  form: FormRow;
  canEdit: boolean;
  /** Page-header slot the action buttons render into. */
  actionsEl: HTMLElement | null;
  onChange: (row: FormRow) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState(form.name);
  const [category, setCategory] = useState(form.category);
  const [def, setDef] = useState<FormDefinition>(form.definition);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "draft" | "publish" | "delete">(null);
  const [metaErrors, setMetaErrors] = useState<MetaValidationError[]>([]);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [previewScreen, setPreviewScreen] = useState(0);

  const issues = useMemo(() => validateFormDefinition(def), [def]);
  const issueFor = (screen: number, field?: number): FormIssue[] =>
    issues.filter((i) => i.screen === screen && i.field === field);

  function update(next: FormDefinition) {
    setDef(next);
    setDirty(true);
  }
  function updateScreen(si: number, patch: Partial<FormScreen>) {
    update({ screens: def.screens.map((s, i) => (i === si ? { ...s, ...patch } : s)) });
  }
  function updateField(si: number, fi: number, patch: Partial<FormField>) {
    const fields = def.screens[si]!.fields.map((f, i) => (i === fi ? { ...f, ...patch } : f));
    updateScreen(si, { fields });
  }
  function moveField(si: number, fi: number, dir: -1 | 1) {
    const fields = [...def.screens[si]!.fields];
    const to = fi + dir;
    if (to < 0 || to >= fields.length) return;
    [fields[fi], fields[to]] = [fields[to]!, fields[fi]!];
    updateScreen(si, { fields });
  }

  async function save(): Promise<FormRow | null> {
    setBusy("save");
    try {
      const res = await fetch(`/api/whatsapp/forms/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, definition: def }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Save failed");
      onChange(json.form);
      setDirty(false);
      return json.form as FormRow;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function upload(publish: boolean) {
    if (issues.length > 0) {
      toast.error(issues[0]!.message);
      return;
    }
    if (dirty && !(await save())) return;
    setBusy(publish ? "publish" : "draft");
    setMetaErrors([]);
    setPermissionError(null);
    try {
      const res = await fetch(`/api/whatsapp/forms/${form.id}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publish }),
      });
      const json = await res.json();
      if (json.form) onChange(json.form);
      if (!res.ok) {
        if (json.permission) setPermissionError(json.error);
        if (Array.isArray(json.validation_errors)) setMetaErrors(json.validation_errors);
        throw new Error(json.error ?? "Upload failed");
      }
      toast.success(
        publish
          ? json.created && form.meta_status === "PUBLISHED"
            ? "Published as a new version on WhatsApp"
            : "Form published on WhatsApp"
          : "Uploaded as a draft — test it with draft mode in a Send WhatsApp Form step",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete "${form.name}" from this CRM? The form stays in WhatsApp Manager.`)) return;
    setBusy("delete");
    try {
      const res = await fetch(`/api/whatsapp/forms/${form.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Delete failed");
      onDeleted(form.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
      setBusy(null);
    }
  }

  const isPublished = form.meta_status === "PUBLISHED";
  const allKeys = def.screens.flatMap((s) => s.fields.map((f) => f.name)).filter(Boolean);
  const disabled = !canEdit || busy !== null;

  return (
    <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-6">
        <section className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="form-name">Form name</Label>
            <Input
              id="form-name"
              value={name}
              maxLength={120}
              disabled={!canEdit}
              onChange={(e) => {
                setName(e.target.value);
                setDirty(true);
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="form-category">Category</Label>
            <Select
              value={category}
              disabled={!canEdit}
              onValueChange={(v) => {
                if (!v) return;
                setCategory(v);
                setDirty(true);
              }}
            >
              <SelectTrigger id="form-category" className="w-full">
                <SelectValue>{CATEGORY_LABELS[category] ?? category}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FLOW_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c] ?? c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            {statusBadge(form)}
            {form.meta_flow_id && (
              <span className="text-xs text-muted-foreground">
                WhatsApp Flow ID <code className="rounded bg-muted px-1">{form.meta_flow_id}</code>
              </span>
            )}
            {dirty && <span className="text-xs text-amber-600 dark:text-amber-300">Unsaved changes</span>}
            {isPublished && (
              <p className="w-full text-xs text-muted-foreground">
                WhatsApp doesn&apos;t allow editing a published form, so publishing again creates a new version.
                Flow steps that picked the old version keep sending it until you re-pick this form.
              </p>
            )}
          </div>
        </section>

        {def.screens.map((screen, si) => (
          <ScreenEditor
            key={si}
            index={si}
            total={def.screens.length}
            screen={screen}
            disabled={!canEdit}
            screenIssues={issueFor(si)}
            fieldIssues={(fi) => issueFor(si, fi)}
            onPatch={(patch) => updateScreen(si, patch)}
            onRemove={() => {
              update({ screens: def.screens.filter((_, i) => i !== si) });
              setPreviewScreen(0);
            }}
            onAddField={(type) => updateScreen(si, { fields: [...screen.fields, newField(type, def)] })}
            onPatchField={(fi, patch) => {
              const field = screen.fields[fi]!;
              // Keep the key in sync with the label until the user edits it.
              if (patch.label !== undefined && field.name === uniqueName(toFieldName(field.label), allNames(def, field))) {
                patch.name = uniqueName(toFieldName(patch.label), allNames(def, field));
              }
              updateField(si, fi, patch);
            }}
            onMoveField={(fi, dir) => moveField(si, fi, dir)}
            onRemoveField={(fi) => updateScreen(si, { fields: screen.fields.filter((_, i) => i !== fi) })}
          />
        ))}

        {canEdit && def.screens.length < FORM_LIMITS.screens && (
          <Button
            variant="outline"
            onClick={() =>
              update({
                screens: [
                  ...def.screens.map((s, i) =>
                    i === def.screens.length - 1 && s.button_label === "Submit" ? { ...s, button_label: "Continue" } : s,
                  ),
                  { title: `Step ${def.screens.length + 1}`, button_label: "Submit", fields: [] },
                ],
              })
            }
          >
            <Plus className="h-4 w-4" /> Add screen
          </Button>
        )}

        {permissionError && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> WhatsApp permission missing
            </div>
            <p className="mt-1 text-muted-foreground">{permissionError}</p>
            <Link href="/settings" className="mt-2 inline-block text-primary underline-offset-4 hover:underline">
              Open WhatsApp settings
            </Link>
          </div>
        )}
        {(metaErrors.length > 0 || (form.last_error && !permissionError)) && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <AlertTriangle className="h-4 w-4" /> WhatsApp rejected the last upload
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
              {metaErrors.length > 0
                ? metaErrors.map((e, i) => <li key={i}>{e.message}</li>)
                : form.last_error!.split("\n").map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </div>
        )}

        <div className="rounded-lg border p-4 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <CheckCircle2 className="h-4 w-4 text-emerald-500" /> Using this form
          </div>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
            <li>Publish it (or upload a draft to test).</li>
            <li>
              In a flow, add <span className="text-foreground">Send WhatsApp Form</span> and pick{" "}
              <span className="text-foreground">{form.name}</span>.
            </li>
            <li>After the customer submits, use the answers as variables:</li>
          </ol>
          <div className="mt-2 flex flex-wrap gap-1">
            {allKeys.map((k) => (
              <code key={k} className="rounded bg-muted px-1 text-xs">{`{{vars.form.${k}}}`}</code>
            ))}
          </div>
        </div>

        {actionsEl && createPortal(<>
          {issues.length > 0 && (
            <span className="text-xs text-destructive">
              {issues.length} issue{issues.length > 1 ? "s" : ""} to fix
            </span>
          )}
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="outline" disabled={disabled || !dirty} onClick={() => void save()}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save
          </Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => void upload(false)}>
            {busy === "draft" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            Upload as draft
          </Button>
          <Button size="sm" disabled={disabled} onClick={() => void upload(true)}>
            {busy === "publish" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isPublished ? "Publish new version" : "Publish"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground hover:text-destructive"
            disabled={disabled}
            onClick={() => void remove()}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
        </>, actionsEl)}
      </div>

      <aside className="xl:sticky xl:top-4 xl:self-start">
        <Preview def={def} screen={Math.min(previewScreen, def.screens.length - 1)} onScreen={setPreviewScreen} />
      </aside>
    </div>
  );
}

function IssueList({ issues }: { issues: FormIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-destructive">
      {issues.map((i, n) => (
        <li key={n}>{i.message}</li>
      ))}
    </ul>
  );
}

function ScreenEditor({
  index,
  total,
  screen,
  disabled,
  screenIssues,
  fieldIssues,
  onPatch,
  onRemove,
  onAddField,
  onPatchField,
  onMoveField,
  onRemoveField,
}: {
  index: number;
  total: number;
  screen: FormScreen;
  disabled: boolean;
  screenIssues: FormIssue[];
  fieldIssues: (fi: number) => FormIssue[];
  onPatch: (patch: Partial<FormScreen>) => void;
  onRemove: () => void;
  onAddField: (type: FormFieldType) => void;
  onPatchField: (fi: number, patch: Partial<FormField>) => void;
  onMoveField: (fi: number, dir: -1 | 1) => void;
  onRemoveField: (fi: number) => void;
}) {
  const isLast = index === total - 1;
  return (
    <section className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">
          Screen {index + 1}
          <span className="ml-2 font-normal text-muted-foreground">
            {isLast ? "· last screen, submits the form" : "· continues to the next screen"}
          </span>
        </h2>
        {total > 1 && !disabled && (
          <Button variant="ghost" size="icon-xs" onClick={onRemove} aria-label="Remove screen">
            <X />
          </Button>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Screen title</Label>
          <Input value={screen.title} disabled={disabled} onChange={(e) => onPatch({ title: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Button label</Label>
          <Input
            value={screen.button_label}
            maxLength={FORM_LIMITS.footerLabel}
            disabled={disabled}
            onChange={(e) => onPatch({ button_label: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Heading (optional)</Label>
          <Input
            value={screen.heading ?? ""}
            maxLength={FORM_LIMITS.heading}
            disabled={disabled}
            onChange={(e) => onPatch({ heading: e.target.value })}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Description (optional)</Label>
          <Textarea
            rows={2}
            value={screen.body ?? ""}
            disabled={disabled}
            onChange={(e) => onPatch({ body: e.target.value })}
          />
        </div>
      </div>
      <IssueList issues={screenIssues} />

      <div className="space-y-3">
        {screen.fields.map((field, fi) => (
          <FieldEditor
            key={fi}
            field={field}
            disabled={disabled}
            issues={fieldIssues(fi)}
            first={fi === 0}
            last={fi === screen.fields.length - 1}
            onPatch={(patch) => onPatchField(fi, patch)}
            onMove={(dir) => onMoveField(fi, dir)}
            onRemove={() => onRemoveField(fi)}
          />
        ))}
      </div>

      {!disabled && (
        <div className="flex items-center gap-2">
          <Select
            value={null}
            onValueChange={(v) => {
              if (v) onAddField(v as FormFieldType);
            }}
          >
            <SelectTrigger aria-label="Add a question">
              <SelectValue>+ Add a question…</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {FORM_FIELD_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {FORM_FIELD_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </section>
  );
}

function FieldEditor({
  field,
  disabled,
  issues,
  first,
  last,
  onPatch,
  onMove,
  onRemove,
}: {
  field: FormField;
  disabled: boolean;
  issues: FormIssue[];
  first: boolean;
  last: boolean;
  onPatch: (patch: Partial<FormField>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const labelMax = FORM_LIMITS.label[field.type];
  const options = field.options ?? [];
  const setOptionTitles = (titles: string[]) => {
    const ids = optionIds(titles);
    onPatch({ options: titles.map((title, i) => ({ id: ids[i]!, title })) });
  };

  return (
    <div className={cn("space-y-3 rounded-md border bg-muted/30 p-3", issues.length > 0 && "border-destructive/50")}>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={field.type}
          disabled={disabled}
          onValueChange={(v) => {
            if (!v) return;
            const type = v as FormFieldType;
            onPatch({
              type,
              options: hasOptions(type)
                ? field.options?.length
                  ? field.options
                  : [{ id: "option_1", title: "Option 1" }]
                : undefined,
            });
          }}
        >
          <SelectTrigger aria-label="Question type">
            <SelectValue>{FORM_FIELD_TYPE_LABELS[field.type]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FORM_FIELD_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {FORM_FIELD_TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            checked={field.required}
            disabled={disabled}
            onCheckedChange={(checked) => onPatch({ required: checked })}
          />
          Required
        </label>
        {!disabled && (
          <div className="ml-auto flex items-center">
            <Button variant="ghost" size="icon-xs" disabled={first} onClick={() => onMove(-1)} aria-label="Move up">
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-xs" disabled={last} onClick={() => onMove(1)} aria-label="Move down">
              <ArrowDown />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className="hover:text-destructive"
              onClick={onRemove}
              aria-label="Remove question"
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="flex justify-between">
            <span>{field.type === "optin" ? "Consent text" : "Question"}</span>
            <span className="font-normal text-muted-foreground">
              {field.label.length}/{labelMax}
            </span>
          </Label>
          <Input value={field.label} disabled={disabled} onChange={(e) => onPatch({ label: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Answer key</Label>
          <Input
            value={field.name}
            disabled={disabled}
            className="font-mono text-xs"
            onChange={(e) => onPatch({ name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
          />
        </div>
        {(["text", "email", "phone", "number", "textarea", "date"] as FormFieldType[]).includes(field.type) && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Helper text (optional)</Label>
            <Input
              value={field.helper_text ?? ""}
              maxLength={FORM_LIMITS.helperText}
              disabled={disabled}
              onChange={(e) => onPatch({ helper_text: e.target.value })}
            />
          </div>
        )}
      </div>

      {hasOptions(field.type) && (
        <div className="space-y-2">
          <Label>Options</Label>
          {options.map((o, oi) => (
            <div key={oi} className="flex items-center gap-2">
              <Input
                value={o.title}
                maxLength={FORM_LIMITS.optionTitle}
                disabled={disabled}
                onChange={(e) => setOptionTitles(options.map((x, i) => (i === oi ? e.target.value : x.title)))}
              />
              <code className="hidden shrink-0 text-xs text-muted-foreground sm:block">{o.id}</code>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setOptionTitles(options.filter((_, i) => i !== oi).map((x) => x.title))}
                  aria-label="Remove option"
                >
                  <X />
                </Button>
              )}
            </div>
          ))}
          {!disabled && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setOptionTitles([...options.map((x) => x.title), `Option ${options.length + 1}`])}
            >
              <Plus className="h-4 w-4" /> Add option
            </Button>
          )}
        </div>
      )}
      <IssueList issues={issues} />
    </div>
  );
}

/** WhatsApp-style phone rendering of one screen — stays in view while editing. */
function Preview({
  def,
  screen,
  onScreen,
}: {
  def: FormDefinition;
  screen: number;
  onScreen: (i: number) => void;
}) {
  const s = def.screens[screen];
  if (!s) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>Preview on WhatsApp</span>
        {def.screens.length > 1 && (
          <div className="flex gap-1">
            {def.screens.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onScreen(i)}
                className={cn("rounded px-1.5", i === screen ? "bg-primary text-primary-foreground" : "hover:bg-accent")}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      {/* Phone bezel; the form sheet rises over a dimmed chat like in WhatsApp. */}
      <div className="mx-auto w-full max-w-[300px] rounded-[2.25rem] border-[6px] border-neutral-900 bg-neutral-900 shadow-lg">
        <div className="flex h-[min(620px,calc(100dvh-10rem))] min-h-[420px] flex-col overflow-hidden rounded-[1.85rem] bg-[#0b141a]">
          <div className="flex items-center justify-between px-5 pt-2 pb-1 text-[10px] font-medium text-white/80">
            <span>9:41</span>
            <span className="h-3.5 w-16 rounded-full bg-black" />
            <span>100%</span>
          </div>
          <div className="h-8 shrink-0" />
          <div className="flex min-h-0 flex-1 flex-col rounded-t-2xl bg-white text-neutral-900">
            <div className="flex shrink-0 items-center gap-2 border-b border-neutral-200 px-3 py-2.5">
              <X className="h-4 w-4 text-neutral-600" />
              <div className="min-w-0 flex-1 truncate text-center text-sm font-semibold">
                {s.title || "Untitled"}
              </div>
              <span className="text-base leading-none text-neutral-500">⋮</span>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
              {s.heading && <div className="text-base font-bold">{s.heading}</div>}
              {s.body && <p className="whitespace-pre-wrap text-neutral-600">{s.body}</p>}
              {s.fields.map((f, i) => (
                <PreviewField key={i} field={f} />
              ))}
            </div>
            <div className="shrink-0 border-t border-neutral-200 px-4 pt-2.5 pb-3">
              <div className="rounded-full bg-[#1daa61] py-2 text-center text-sm font-medium text-white">
                {s.button_label || "Submit"}
              </div>
              <div className="mt-1.5 text-center text-[10px] text-neutral-500">
                Managed by the business. <span className="text-[#1daa61]">Learn more</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PreviewField({ field }: { field: FormField }) {
  const label = `${field.label || "Question"}${field.required ? "" : " (optional)"}`;
  if (field.type === "optin") {
    return (
      <div className="flex items-start gap-2">
        <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-neutral-400" />
        <span>{label}</span>
      </div>
    );
  }
  if (field.type === "radio" || field.type === "checkbox") {
    return (
      <div>
        <div className="mb-1 font-medium">{label}</div>
        {(field.options ?? []).map((o) => (
          <div key={o.id} className="flex items-center gap-2 py-0.5">
            <span className={cn("h-4 w-4 shrink-0 border border-neutral-400", field.type === "radio" ? "rounded-full" : "rounded")} />
            {o.title}
          </div>
        ))}
      </div>
    );
  }
  return (
    <div>
      <div className="rounded-md border border-neutral-300 px-3 py-2 text-neutral-500">
        {label}
        {field.type === "date" && " 📅"}
        {field.type === "dropdown" && " ▾"}
      </div>
      {field.helper_text && <div className="mt-0.5 text-xs text-neutral-500">{field.helper_text}</div>}
    </div>
  );
}
