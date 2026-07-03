"use client";

import { useEffect, useState } from "react";
import { Copy, Plus, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { flattenPayloadKeys } from "@/lib/automations/webhook-payload";
import { generateWebhookToken } from "@/lib/automations/webhook-token";
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
  const [regenerating, setRegenerating] = useState(false);

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

  async function regenerateToken() {
    if (!flowId) {
      onChange({ ...config, webhook_token: generateWebhookToken() });
      toast.success("New webhook token generated — save to apply");
      return;
    }
    setRegenerating(true);
    try {
      const res = await fetch(`/api/flows/${flowId}/webhook-sample`, {
        method: "POST",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body?.error ?? "Could not regenerate token");
        return;
      }
      onChange({ ...config, webhook_token: body.webhook_token });
      toast.success("Webhook URL regenerated");
    } finally {
      setRegenerating(false);
    }
  }

  function setMapping(varName: string, path: string) {
    onChange({
      ...config,
      variable_mappings: { ...mappings, [varName]: path },
    });
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
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={regenerateToken}
            disabled={regenerating}
            aria-label="Regenerate webhook URL"
          >
            <RefreshCw className={cn("h-4 w-4", regenerating && "animate-spin")} />
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
          <div key={varName} className="mb-2 flex gap-1">
            <Input
              value={varName}
              readOnly
              className="w-28 bg-muted text-xs"
            />
            <Input
              value={path}
              onChange={(e) => setMapping(varName, e.target.value)}
              className="flex-1 bg-muted text-xs"
              list="flow-webhook-payload-keys"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => removeMapping(varName)}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
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
