"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface StageMoveReasonDialogProps {
  open: boolean;
  fromStageName: string;
  toStageName: string;
  reason: string;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
  confirmLabel?: string;
}

export function StageMoveReasonDialog({
  open,
  fromStageName,
  toStageName,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
  loading = false,
  confirmLabel = "Move deal",
}: StageMoveReasonDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onCancel();
      }}
    >
      <DialogContent className="border-border bg-popover sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-popover-foreground">
            Reason for move
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            Moving from{" "}
            <span className="font-medium text-foreground">{fromStageName}</span>{" "}
            to{" "}
            <span className="font-medium text-foreground">{toStageName}</span>
          </p>
          <div>
            <Label htmlFor="stage-move-reason" className="text-muted-foreground">
              Reason
            </Label>
            <Textarea
              id="stage-move-reason"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              placeholder="Why is this deal being moved?"
              rows={3}
              className="mt-2 border-border bg-muted text-foreground placeholder:text-muted-foreground"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && reason.trim()) {
                  onConfirm();
                }
              }}
            />
          </div>
        </div>
        <DialogFooter className="border-border bg-popover/50">
          <Button
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className="border-border text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            onClick={onConfirm}
            disabled={loading || !reason.trim()}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {loading ? "Saving..." : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
