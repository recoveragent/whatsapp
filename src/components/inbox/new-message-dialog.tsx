"use client";

import { useState, useCallback } from "react";
import { MessageSquarePlus, Loader2 } from "lucide-react";
import { toast } from "sonner";

import type { Conversation } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface NewMessageDialogProps {
  onCreated: (conversation: Conversation) => void;
}

export function NewMessageDialog({ onCreated }: NewMessageDialogProps) {
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = useCallback(() => {
    setPhone("");
    setName("");
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      toast.error("Enter a phone number");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/inbox/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: trimmedPhone,
          name: name.trim() || undefined,
        }),
      });

      const data = (await res.json()) as Conversation & { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Could not start conversation");
        return;
      }

      onCreated(data);
      setOpen(false);
      reset();
      toast.success("Conversation ready — send your first message");
    } catch {
      toast.error("Could not start conversation");
    } finally {
      setSubmitting(false);
    }
  }, [phone, name, onCreated, reset]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger
        render={
          <Button size="sm" className="h-8 gap-1.5 bg-primary text-xs hover:bg-primary/90">
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New message
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Start a conversation</DialogTitle>
          <DialogDescription>
            Enter the customer&apos;s WhatsApp number with country code. If they already
            exist, their thread will open.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="new-msg-phone">Phone number</Label>
            <Input
              id="new-msg-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+37061234567"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-msg-name">Name (optional)</Label>
            <Input
              id="new-msg-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer name"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating…
              </>
            ) : (
              "Open chat"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
