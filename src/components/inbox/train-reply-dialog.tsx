"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GraduationCap, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MAX_INSTRUCTION_LENGTH } from "@/lib/ai/reply-guidance";
import type { Message } from "@/types";

interface TrainReplyDialogProps {
  /** The AI reply being corrected; null closes the dialog. */
  message: Message | null;
  /** Customer text the AI was answering (display only; the server re-reads it). */
  customerMessage: string | null;
  onOpenChange: (open: boolean) => void;
}

/**
 * Lets the team tell the AI agent how to answer messages like this one
 * next time. Saved corrections live in AI Agents → Train Agent.
 */
export function TrainReplyDialog({
  message,
  customerMessage,
  onOpenChange,
}: TrainReplyDialogProps) {
  const [instruction, setInstruction] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (message) setInstruction("");
  }, [message]);

  const save = async () => {
    if (!message || !instruction.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/ai/reply-guidance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message_id: message.id, instruction }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save the correction.");
      toast.success("Saved. The AI agent will use this for similar messages.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the correction.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!message} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] grid-cols-[minmax(0,1fr)] overflow-y-auto border-border bg-popover sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-popover-foreground">
            <GraduationCap className="h-4 w-4 text-primary" />
            Train this reply
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Tell the AI agent how to respond when a customer sends a similar
            message next time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          {customerMessage && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Customer wrote</p>
              <p className="max-h-24 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-foreground">
                {customerMessage}
              </p>
            </div>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">AI replied</p>
            <p className="max-h-32 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md bg-muted px-3 py-2 text-foreground">
              {message?.content_text || "(no text)"}
            </p>
          </div>
          <div>
            <label htmlFor="train-instruction" className="mb-1 block text-xs font-medium text-muted-foreground">
              How should it respond next time?
            </label>
            <Textarea
              id="train-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={MAX_INSTRUCTION_LENGTH}
              rows={4}
              autoFocus
              placeholder="e.g. Ask which size and shape they want before sharing a link, and mention we personalise it with their photo."
            />
            <p className="mt-1 text-right text-[11px] text-muted-foreground">
              {instruction.length}/{MAX_INSTRUCTION_LENGTH}
            </p>
          </div>
        </div>

        <DialogFooter className="items-center gap-2 sm:justify-between">
          <Link
            href="/agents"
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            Manage saved corrections
          </Link>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !instruction.trim()}>
              {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Save correction
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
