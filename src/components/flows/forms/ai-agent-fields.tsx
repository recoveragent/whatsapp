"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/hooks/use-auth";
import { TextRow } from "./fields";

type AgentStatus = "loading" | "live" | "off" | "unavailable";

/**
 * Config for the `ai_agent` node: an optional goal and whether the agent
 * answers the customer's latest message right away. Also tells the
 * builder whether the agent will actually reply — the node only
 * re-enables the agent on the chat; the brand still needs AI Agents
 * enabled with auto-replies on.
 */
export function AiAgentFields({
  cfg,
  onUpdateConfig,
}: {
  cfg: { goal?: string; respond_now?: boolean };
  onUpdateConfig: (patch: Record<string, unknown>) => void;
}) {
  const { isAiAgentsEnabled, accountId } = useAuth();
  const [replyStatus, setReplyStatus] = useState<"live" | "off" | null>(null);
  const status: AgentStatus = !isAiAgentsEnabled
    ? "unavailable"
    : (replyStatus ?? "loading");

  useEffect(() => {
    if (!isAiAgentsEnabled) return;
    const controller = new AbortController();
    fetch("/api/ai/config", { signal: controller.signal })
      .then((res) => res.json())
      .then((data) =>
        setReplyStatus(data?.is_active && data?.auto_reply_enabled ? "live" : "off")
      )
      .catch(() => {
        if (!controller.signal.aborted) setReplyStatus("off");
      });
    return () => controller.abort();
  }, [isAiAgentsEnabled, accountId]);

  return (
    <div className="space-y-3">
      <TextRow
        label="Goal for the AI agent (optional)"
        value={cfg.goal ?? ""}
        onChange={(v) => onUpdateConfig({ goal: v })}
        rows={3}
      />
      <p className="text-muted-foreground text-xs">
        e.g. “Help {"{{ vars.first_name }}"} finish their checkout and answer
        questions about delivery.” The agent still follows its training and
        hands off to your team when it can’t help.
      </p>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={cfg.respond_now !== false}
          onChange={(e) => onUpdateConfig({ respond_now: e.target.checked })}
        />
        <span>
          Reply to the customer’s last message right away
          <span className="text-muted-foreground block">
            When off, the agent waits for their next message. Flows started by
            store events always wait.
          </span>
        </span>
      </label>
      {status !== "loading" && status !== "live" && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-700 dark:text-amber-400">
          {status === "unavailable"
            ? "AI Agents aren’t enabled for this brand yet, so the chat will stay with your team."
            : "AI auto-replies are off, so the chat will stay with your team. "}
          {status === "off" && (
            <Link href="/agents" className="font-medium underline">
              Turn them on in AI Agents
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
