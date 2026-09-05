"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { flattenPayloadKeys } from "@/lib/automations/webhook-payload";
import type { FlowWebhookTriggerConfig } from "@/lib/flows/webhook-config";

export function FlowWebhookTriggerPanel({
  flowId,
  config,
  onChange,
}: {
  flowId?: string;
  config: FlowWebhookTriggerConfig;
  onChange: (c: Record<string, unknown>) => void;
}) {
  const [origin, setOrigin] = useState("");
  const [checking, setChecking] = useState(false);
  const [samplePayload, setSamplePayload] = useState<unknown>(
    config.last_received_payload,
  );
  const [sampleAt, setSampleAt] = useState<string | null>(
    config.last_received_at ?? null,
  );
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const token = config.webhook_token ?? "";
  const webhookUrl = token ? `${origin}/api/flows/webhook/${token}` : "";
  const payloadKeys = samplePayload ? flattenPayloadKeys(samplePayload) : [];
  const mappings = config.variable_mappings ?? {};

  async function copyUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      toast.success("Webhook URL copied");
    } catch {
      toast.error("Could not copy URL");
    }
  }

  async function checkReceived() {
    if (!flowId) {
      toast.error("Save the flow first to check for received webhooks");
      return;
    }
    setChecking(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/webhook-sample`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Could not check for webhooks");
        return;
      }
      setSamplePayload(body.payload ?? null);
      setSampleAt(body.received_at ?? null);
      if (!body.payload) {
        toast.message("No webhook received yet", {
          description: "Send a test POST request, then check again.",
        });
      } else {
        toast.success("Webhook payload received");
      }
    } finally {
      setChecking(false);
    }
  }

  function setMapping(varName: string, path: string) {
    onChange({
      ...config,
      variable_mappings: { ...mappings, [varName]: path },
    });
  }

  function renameMapping(oldName: string, newName: string, path: string) {
    const nextName = newName.replace(/[^a-zA-Z0-9_]/g, "");
    if (!nextName || nextName === oldName) return;
    if (nextName in mappings && nextName !== oldName) {
      toast.error(`Variable "${nextName}" already exists`);
      return;
    }
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(mappings)) {
      next[k === oldName ? nextName : k] = k === oldName ? path : v;
    }
    onChange({ ...config, variable_mappings: next });
  }

  function removeMapping(varName: string) {
    const next = { ...mappings };
    delete next[varName];
    onChange({ ...config, variable_mappings: next });
  }

  return (
    <div className="space-y-3 md:col-span-2">
      {!flowId && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-200">
          Save this flow before using the webhook URL — the token is only registered after save.
        </p>
      )}
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">Webhook URL</label>
        <div className="flex gap-1">
          <Input
            readOnly
            value={webhookUrl || "Save to generate URL"}
            className="bg-muted font-mono text-[11px]"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={copyUrl}
            disabled={!webhookUrl}
            aria-label="Copy webhook URL"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Path to phone number (required)
        </label>
        <Input
          value={config.phone_path ?? "phone"}
          onChange={(e) => onChange({ ...config, phone_path: e.target.value })}
          className="bg-muted"
          placeholder="phone"
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Name path</label>
          <Input
            value={config.name_path ?? "name"}
            onChange={(e) => onChange({ ...config, name_path: e.target.value })}
            className="bg-muted"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">Email path</label>
          <Input
            value={config.email_path ?? "email"}
            onChange={(e) => onChange({ ...config, email_path: e.target.value })}
            className="bg-muted"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Allowed trigger events (optional)
        </label>
        <Input
          value={(config.allowed_trigger_events ?? []).join(", ")}
          onChange={(e) => {
            const list = e.target.value
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean);
            onChange({
              ...config,
              allowed_trigger_events: list.length > 0 ? list : undefined,
            });
          }}
          className="bg-muted"
          placeholder="BOOKING_CREATED, BOOKING_RESCHEDULED"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          Comma-separated Cal.com <code className="text-[10px]">triggerEvent</code>{" "}
          values. Empty = accept all.{" "}
          <code className="text-[10px]">BOOKING_CANCELLED</code> /{" "}
          <code className="text-[10px]">BOOKING_RESCHEDULED</code> still clear
          pending waits for <code className="text-[10px]">booking_uid</code>;
          reschedule can restart the flow if listed here.
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Timezone path (optional — formats ISO dates for WhatsApp)
        </label>
        <Input
          value={config.timezone_path ?? ""}
          onChange={(e) =>
            onChange({ ...config, timezone_path: e.target.value })
          }
          className="bg-muted"
          placeholder="payload.attendees.0.timeZone"
          list="flow-webhook-payload-keys"
        />
        <p className="mt-1 text-[11px] text-muted-foreground">
          ISO times like{" "}
          <code className="text-[10px]">2026-08-14T04:30:00Z</code> become{" "}
          <code className="text-[10px]">14 Aug 2026, 10:00 am</code> in this
          timezone (Cal.com defaults to attendee timezone if empty).
        </p>
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={checkReceived}
          disabled={checking}
        >
          {checking ? "Checking…" : "Check for received webhook"}
        </Button>
        {sampleAt && (
          <span className="text-[11px] text-muted-foreground">
            Last received: {new Date(sampleAt).toLocaleString()}
          </span>
        )}
      </div>

      <div>
        <label className="mb-1 block text-xs text-muted-foreground">
          Template variable mappings (use in Send template nodes as{" "}
          <code className="text-[10px]">{"{{ vars.name }}"}</code>)
        </label>
        {Object.entries(mappings).map(([varName, path]) => (
          <MappingNameRow
            key={varName}
            varName={varName}
            path={path}
            onRename={(next) => renameMapping(varName, next, path)}
            onPathChange={(nextPath) => setMapping(varName, nextPath)}
            onRemove={() => removeMapping(varName)}
          />
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMapping(`var_${Object.keys(mappings).length + 1}`, "")}
        >
          <Plus className="mr-1 h-3 w-3" />
          Add mapping
        </Button>
        {payloadKeys.length > 0 && (
          <datalist id="flow-webhook-payload-keys">
            {payloadKeys.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
        )}
      </div>
    </div>
  );
}

function MappingNameRow({
  varName,
  path,
  onRename,
  onPathChange,
  onRemove,
}: {
  varName: string;
  path: string;
  onRename: (next: string) => void;
  onPathChange: (nextPath: string) => void;
  onRemove: () => void;
}) {
  const [draftName, setDraftName] = useState(varName);

  useEffect(() => {
    setDraftName(varName);
  }, [varName]);

  return (
    <div className="mb-2 flex gap-1">
      <Input
        value={draftName}
        onChange={(e) =>
          setDraftName(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))
        }
        onBlur={() => onRename(draftName)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.currentTarget.blur();
          }
        }}
        placeholder="meeting_time"
        className="w-28 bg-muted font-mono text-xs"
      />
      <Input
        value={path}
        onChange={(e) => onPathChange(e.target.value)}
        className="flex-1 bg-muted text-xs"
        list="flow-webhook-payload-keys"
        placeholder="payload.startTime"
      />
      <Button type="button" variant="ghost" size="icon" onClick={onRemove}>
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}
